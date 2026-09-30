import { DatabaseClient, DatabaseTransaction } from "../db/types.js";
import { PollingCheckpointRecord } from "../domain/models/change.model.js";

interface DbCheckpointRow {
  source: string;
  last_updated_at?: Date | string | null;
  cursor?: string | null;
  updated_at: Date | string;
}

export class CheckpointRepository {
  public async getCheckpoint(
    client: DatabaseClient | DatabaseTransaction,
    source: string
  ): Promise<PollingCheckpointRecord | null> {
    const sql = `
      SELECT source, last_updated_at, cursor, updated_at
      FROM polling_checkpoints
      WHERE source = $1
    `;
    const result = await client.query<DbCheckpointRow>(sql, [source]);
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      source: row.source,
      lastUpdatedAt: row.last_updated_at ? new Date(row.last_updated_at) : null,
      cursor: row.cursor || null,
      updatedAt: new Date(row.updated_at),
    };
  }

  public async saveCheckpoint(
    client: DatabaseTransaction | DatabaseClient,
    source: string,
    lastUpdatedAt?: Date | null,
    cursor?: string | null
  ): Promise<void> {
    const sql = `
      INSERT INTO polling_checkpoints (source, last_updated_at, cursor, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (source) DO UPDATE
      SET last_updated_at = EXCLUDED.last_updated_at,
          cursor = EXCLUDED.cursor,
          updated_at = NOW()
    `;
    await client.query(sql, [source, lastUpdatedAt || null, cursor || null]);
  }
}
