import { DatabaseClient } from "../../db/types.js";
import { NormalizedChange, ProcessResult } from "../../domain/models/change.model.js";
import { ChangeRepository } from "../../repositories/change.repository.js";
import { IdempotencyRepository } from "../../repositories/idempotency.repository.js";
import { ChangeDetector } from "../detector/change-detector.js";

export class ChangeProcessor {
  private db: DatabaseClient;
  private idempotencyRepo: IdempotencyRepository;
  private changeRepo: ChangeRepository;
  private detector: ChangeDetector;

  constructor(
    db: DatabaseClient,
    idempotencyRepo: IdempotencyRepository = new IdempotencyRepository(),
    changeRepo: ChangeRepository = new ChangeRepository(),
    detector: ChangeDetector = new ChangeDetector()
  ) {
    this.db = db;
    this.idempotencyRepo = idempotencyRepo;
    this.changeRepo = changeRepo;
    this.detector = detector;
  }

  public async processChange(change: NormalizedChange): Promise<ProcessResult> {
    return this.db.transaction(async (tx) => {
      // 1. Try to record the ingestion event
      const insertedEvent = await this.idempotencyRepo.insertEventIfAbsent(tx, change);

      if (!insertedEvent) {
        return {
          status: "DUPLICATE_EVENT",
          productId: change.productId,
          idempotencyKey: change.idempotencyKey,
          payloadHash: change.payloadHash,
          message: "Duplicate event detected and safely skipped",
        };
      }

      // 2. Lock per product ID to serialize concurrent updates for the same product
      await tx.advisoryLock(change.productId);

      // 3. Query the latest product change
      const latest = await this.changeRepo.getLatestProductChange(tx, change.productId);

      // 4. Detect change vs latest
      const decision = this.detector.evaluate(latest, change);

      if (decision.status === "STALE") {
        await this.idempotencyRepo.markEventProcessed(tx, change.idempotencyKey, "STALE");
        return {
          status: "STALE",
          productId: change.productId,
          idempotencyKey: change.idempotencyKey,
          payloadHash: change.payloadHash,
          message: "Stale data: incoming version is older than latest recorded",
        };
      }

      if (decision.status === "NO_CHANGE") {
        await this.idempotencyRepo.markEventProcessed(tx, change.idempotencyKey, "NO_CHANGE");
        return {
          status: "NO_CHANGE",
          productId: change.productId,
          idempotencyKey: change.idempotencyKey,
          payloadHash: change.payloadHash,
          message: "No change detected in payload",
        };
      }

      // 5. Insert new product change record (unique constraint is final safety net)
      const inserted = await this.changeRepo.insertProductChange(tx, change);

      if (!inserted) {
        await this.idempotencyRepo.markEventProcessed(tx, change.idempotencyKey, "NO_CHANGE");
        return {
          status: "NO_CHANGE",
          productId: change.productId,
          idempotencyKey: change.idempotencyKey,
          payloadHash: change.payloadHash,
          message: "Product state already exists in database",
        };
      }

      // 6. Mark ingestion event as INSERTED
      await this.idempotencyRepo.markEventProcessed(tx, change.idempotencyKey, "INSERTED");
      return {
        status: "INSERTED",
        productId: change.productId,
        idempotencyKey: change.idempotencyKey,
        payloadHash: change.payloadHash,
        message: "New product change recorded successfully",
      };
    });
  }
}
