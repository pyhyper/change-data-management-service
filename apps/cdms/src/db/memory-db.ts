import { DatabaseClient, DatabaseTransaction, QueryResult } from "./types.js";

interface IngestionEventRow {
  id: number;
  idempotency_key: string;
  source: string;
  payload_hash: string;
  status: string;
  created_at: Date;
  processed_at?: Date | null;
  error_message?: string | null;
}

interface ProductChangeRow {
  id: number;
  product_id: string;
  source: string;
  source_updated_at: Date;
  payload: Record<string, unknown>;
  payload_hash: string;
  created_at: Date;
}

interface PollingCheckpointRow {
  source: string;
  last_updated_at?: Date | null;
  cursor?: string | null;
  updated_at: Date;
}

export class MemoryDatabaseClient implements DatabaseClient {
  private events: Map<string, IngestionEventRow> = new Map();
  private changes: ProductChangeRow[] = [];
  private checkpoints: Map<string, PollingCheckpointRow> = new Map();

  private eventIdSeq = 1;
  private changeIdSeq = 1;

  // Mutex per product id for advisory locking simulation
  private productLocks: Map<string, Promise<void>> = new Map();

  public async acquireProductLock(productId: string): Promise<() => void> {
    while (this.productLocks.has(productId)) {
      try {
        await this.productLocks.get(productId);
      } catch {
        // continue
      }
    }

    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.productLocks.set(productId, lockPromise);

    return () => {
      this.productLocks.delete(productId);
      releaseLock();
    };
  }

  public async isHealthy(): Promise<boolean> {
    return true;
  }

  public async close(): Promise<void> {
    this.events.clear();
    this.changes = [];
    this.checkpoints.clear();
  }

  public reset(): void {
    this.events.clear();
    this.changes = [];
    this.checkpoints.clear();
    this.eventIdSeq = 1;
    this.changeIdSeq = 1;
    this.productLocks.clear();
  }

  public async query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const trimmed = sql.trim().toLowerCase();

    // Checkpoints query
    if (trimmed.startsWith("select") && trimmed.includes("polling_checkpoints")) {
      const source = String(params[0]);
      const cp = this.checkpoints.get(source);
      return { rows: cp ? ([cp] as unknown as T[]) : [] };
    }

    // Save/Upsert polling_checkpoints
    if (trimmed.startsWith("insert into polling_checkpoints") && trimmed.includes("on conflict")) {
      const source = String(params[0]);
      const lastUpdatedAt = params[1] ? new Date(params[1] as string | Date) : null;
      const cursor = params[2] ? String(params[2]) : null;

      const row: PollingCheckpointRow = {
        source,
        last_updated_at: lastUpdatedAt,
        cursor,
        updated_at: new Date(),
      };
      this.checkpoints.set(source, row);
      return { rows: [{ source }] as unknown as T[] };
    }

    // Latest product change query (specifically has limit 1)
    if (trimmed.startsWith("select") && trimmed.includes("product_changes") && trimmed.includes("limit 1")) {
      const productId = String(params[0]);
      const matching = this.changes
        .filter((c) => c.product_id === productId)
        .sort((a, b) => b.source_updated_at.getTime() - a.source_updated_at.getTime() || b.id - a.id);

      return { rows: matching.length > 0 ? ([matching[0]] as unknown as T[]) : [] };
    }

    // Select all product changes (listChanges)
    if (trimmed.startsWith("select") && trimmed.includes("product_changes")) {
      if (params.length > 0) {
        const productId = String(params[0]);
        const matching = this.changes
          .filter((c) => c.product_id === productId)
          .sort((a, b) => b.source_updated_at.getTime() - a.source_updated_at.getTime() || b.id - a.id);
        return { rows: matching as unknown as T[] };
      }
      return { rows: [...this.changes] as unknown as T[] };
    }

    // Select ingestion events
    if (trimmed.startsWith("select") && trimmed.includes("ingestion_events")) {
      return { rows: Array.from(this.events.values()) as unknown as T[] };
    }

    return { rows: [] };
  }

  public async transaction<T>(action: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    // Snapshot state for rollback
    const eventsSnapshot = new Map(this.events);
    const changesSnapshot = [...this.changes];
    const checkpointsSnapshot = new Map(this.checkpoints);
    const eventIdSeqSnapshot = this.eventIdSeq;
    const changeIdSeqSnapshot = this.changeIdSeq;

    const acquiredLockReleases: Array<() => void> = [];

    const tx: DatabaseTransaction = {
      advisoryLock: async (productId: string) => {
        const release = await this.acquireProductLock(productId);
        acquiredLockReleases.push(release);
      },

      query: async <R = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> => {
        const trimmed = sql.trim().toLowerCase();

        // INSERT INTO ingestion_events ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
        if (trimmed.startsWith("insert into ingestion_events")) {
          const idempotencyKey = String(params[0]);
          const source = String(params[1]);
          const payloadHash = String(params[2]);
          const status = String(params[3]);

          if (this.events.has(idempotencyKey)) {
            return { rows: [] }; // Insert skipped due to conflict
          }

          const newId = this.eventIdSeq++;
          const row: IngestionEventRow = {
            id: newId,
            idempotency_key: idempotencyKey,
            source,
            payload_hash: payloadHash,
            status,
            created_at: new Date(),
          };
          this.events.set(idempotencyKey, row);
          return { rows: [{ id: newId }] as unknown as R[] };
        }

        // UPDATE ingestion_events SET status = $1, processed_at = NOW() WHERE idempotency_key = $2
        if (trimmed.startsWith("update ingestion_events")) {
          const status = String(params[0]);
          const idempotencyKey = String(params[1]);
          const row = this.events.get(idempotencyKey);
          if (row) {
            row.status = status;
            row.processed_at = new Date();
          }
          return { rows: [] };
        }

        // INSERT INTO product_changes ... ON CONFLICT (product_id, payload_hash) DO NOTHING RETURNING id
        if (trimmed.startsWith("insert into product_changes")) {
          const productId = String(params[0]);
          const source = String(params[1]);
          const sourceUpdatedAt = new Date(params[2] as string | Date);
          const payload = typeof params[3] === "string" ? JSON.parse(params[3]) : (params[3] as Record<string, unknown>);
          const payloadHash = String(params[4]);

          const duplicate = this.changes.find(
            (c) => c.product_id === productId && c.payload_hash === payloadHash
          );

          if (duplicate) {
            return { rows: [] }; // Unique constraint violated
          }

          const newId = this.changeIdSeq++;
          const row: ProductChangeRow = {
            id: newId,
            product_id: productId,
            source,
            source_updated_at: sourceUpdatedAt,
            payload,
            payload_hash: payloadHash,
            created_at: new Date(),
          };
          this.changes.push(row);
          return { rows: [{ id: newId }] as unknown as R[] };
        }

        // Upsert polling_checkpoints
        if (trimmed.startsWith("insert into polling_checkpoints") && trimmed.includes("on conflict")) {
          const source = String(params[0]);
          const lastUpdatedAt = params[1] ? new Date(params[1] as string | Date) : null;
          const cursor = params[2] ? String(params[2]) : null;

          const row: PollingCheckpointRow = {
            source,
            last_updated_at: lastUpdatedAt,
            cursor,
            updated_at: new Date(),
          };
          this.checkpoints.set(source, row);
          return { rows: [{ source }] as unknown as R[] };
        }

        // Delegation to query
        return this.query<R>(sql, params);
      },
    };

    try {
      const result = await action(tx);
      return result;
    } catch (err) {
      // Rollback memory state
      this.events = eventsSnapshot;
      this.changes = changesSnapshot;
      this.checkpoints = checkpointsSnapshot;
      this.eventIdSeq = eventIdSeqSnapshot;
      this.changeIdSeq = changeIdSeqSnapshot;
      throw err;
    } finally {
      // Release all transaction locks
      for (const release of acquiredLockReleases) {
        release();
      }
    }
  }
}
