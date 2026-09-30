import { DatabaseClient } from "../../db/types.js";
import { NormalizedChange, ProcessResult } from "../../domain/models/change.model.js";
import { computePayloadHash, normalizeProduct } from "../../processing/canonical/canonical.util.js";
import { derivePollingIdempotencyKey } from "../../processing/canonical/idempotency.util.js";
import { ChangeProcessor } from "../../processing/pipeline/change.processor.js";
import { CheckpointRepository } from "../../repositories/checkpoint.repository.js";
import { logger } from "../../utils/logger.js";
import { InventoryClient } from "./inventory-client.js";

export interface PollCycleResult {
  fetchedCount: number;
  processedCount: number;
  results: ProcessResult[];
  newCheckpoint?: Date | null;
}

export class PollingScheduler {
  private db: DatabaseClient;
  private inventoryClient: InventoryClient;
  private changeProcessor: ChangeProcessor;
  private checkpointRepo: CheckpointRepository;
  private intervalMs: number;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private sourceName: string = "INVENTORY_SERVICE";

  constructor(
    db: DatabaseClient,
    inventoryClient: InventoryClient,
    changeProcessor: ChangeProcessor,
    checkpointRepo: CheckpointRepository = new CheckpointRepository(),
    intervalMs: number = 10000
  ) {
    this.db = db;
    this.inventoryClient = inventoryClient;
    this.changeProcessor = changeProcessor;
    this.checkpointRepo = checkpointRepo;
    this.intervalMs = intervalMs;
  }

  public async pollOnce(): Promise<PollCycleResult> {
    logger.info("Executing polling cycle from Inventory Service...");

    // 1. Load last checkpoint
    const checkpoint = await this.checkpointRepo.getCheckpoint(this.db, this.sourceName);
    const lastUpdatedAt = checkpoint?.lastUpdatedAt || null;

    // 2. Fetch changed products from emulator
    const products = await this.inventoryClient.fetchChangedProducts({
      updatedSince: lastUpdatedAt,
      limit: 100,
    });

    if (products.length === 0) {
      logger.debug("Polling cycle finished: no new or changed products found.");
      return {
        fetchedCount: 0,
        processedCount: 0,
        results: [],
        newCheckpoint: lastUpdatedAt,
      };
    }

    const results: ProcessResult[] = [];
    let maxUpdatedAt = lastUpdatedAt;

    // 3. Process each product via shared ChangeProcessor
    for (const rawProduct of products) {
      const normalized = normalizeProduct(rawProduct);
      const payloadHash = computePayloadHash(normalized);
      const idempotencyKey = derivePollingIdempotencyKey(
        normalized.id,
        normalized.updatedAt,
        payloadHash
      );

      const change: NormalizedChange = {
        productId: normalized.id,
        source: "POLL",
        sourceUpdatedAt: new Date(normalized.updatedAt),
        payload: normalized,
        payloadHash,
        idempotencyKey,
      };

      const result = await this.changeProcessor.processChange(change);
      results.push(result);

      const productDate = new Date(normalized.updatedAt);
      if (!maxUpdatedAt || productDate.getTime() > maxUpdatedAt.getTime()) {
        maxUpdatedAt = productDate;
      }
    }

    // 4. Advance checkpoint only after batch succeeds safely
    if (maxUpdatedAt && (!lastUpdatedAt || maxUpdatedAt.getTime() > lastUpdatedAt.getTime())) {
      await this.checkpointRepo.saveCheckpoint(this.db, this.sourceName, maxUpdatedAt);
      logger.info("Checkpoint advanced successfully", {
        source: this.sourceName,
        newCheckpoint: maxUpdatedAt.toISOString(),
      });
    }

    logger.info("Polling cycle completed", {
      fetched: products.length,
      processed: results.length,
    });

    return {
      fetchedCount: products.length,
      processedCount: results.length,
      results,
      newCheckpoint: maxUpdatedAt,
    };
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info("Polling scheduler started", { intervalMs: this.intervalMs });

    const scheduleNext = () => {
      this.timer = setTimeout(async () => {
        if (!this.isRunning) return;
        try {
          await this.pollOnce();
        } catch (err) {
          logger.error("Error occurred during polling cycle", {
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          if (this.isRunning) {
            scheduleNext();
          }
        }
      }, this.intervalMs);
    };

    scheduleNext();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info("Polling scheduler stopped");
  }
}
