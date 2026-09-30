import { DatabaseClient, DatabaseTransaction } from "../db/types.js";
import { IngestionEventRecord, NormalizedChange } from "../domain/models/change.model.js";

export class IdempotencyRepository {
  public async insertEventIfAbsent(tx: DatabaseTransaction, change: NormalizedChange): Promise<boolean> {
    const sql = `
      INSERT INTO ingestion_events (idempotency_key, source, payload_hash, status)
      VALUES ($1, $2, $3, 'PROCESSING')
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `;
    const result = await tx.query<{ id: number }>(sql, [
      change.idempotencyKey,
      change.source,
      change.payloadHash,
    ]);

    return result.rows.length > 0;
  }

  public async markEventProcessed(
    tx: DatabaseTransaction,
    idempotencyKey: string,
    status: string,
    errorMessage?: string
  ): Promise<void> {
    const sql = `
      UPDATE ingestion_events
      SET status = $1, processed_at = NOW(), error_message = $2
      WHERE idempotency_key = $3
    `;
    await tx.query(sql, [status, errorMessage || null, idempotencyKey]);
  }

  public async getEvent(
    client: DatabaseClient | DatabaseTransaction,
    idempotencyKey: string
  ): Promise<IngestionEventRecord | null> {
    const sql = `
      SELECT id, idempotency_key, source, payload_hash, status, created_at, processed_at, error_message
      FROM ingestion_events
      WHERE idempotency_key = $1
    `;
    const result = await client.query<IngestionEventRecord>(sql, [idempotencyKey]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }
}
