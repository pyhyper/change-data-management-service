import { DatabaseClient, DatabaseTransaction } from "../db/types.js";
import { NormalizedChange, ProductChangeRecord } from "../domain/models/change.model.js";

interface DbProductChangeRow {
  id: number;
  product_id: string;
  source: string;
  source_updated_at: Date | string;
  payload: Record<string, unknown> | string;
  payload_hash: string;
  created_at: Date | string;
}

export class ChangeRepository {
  private mapRowToRecord(row: DbProductChangeRow): ProductChangeRecord {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    return {
      id: Number(row.id),
      productId: row.product_id,
      source: row.source as ProductChangeRecord["source"],
      sourceUpdatedAt: new Date(row.source_updated_at),
      payload,
      payloadHash: row.payload_hash,
      createdAt: new Date(row.created_at),
    };
  }

  public async getLatestProductChange(
    client: DatabaseTransaction | DatabaseClient,
    productId: string
  ): Promise<ProductChangeRecord | null> {
    const sql = `
      SELECT id, product_id, source, source_updated_at, payload, payload_hash, created_at
      FROM product_changes
      WHERE product_id = $1
      ORDER BY source_updated_at DESC, id DESC
      LIMIT 1
    `;
    const result = await client.query<DbProductChangeRow>(sql, [productId]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapRowToRecord(result.rows[0]);
  }

  public async insertProductChange(
    tx: DatabaseTransaction,
    change: NormalizedChange
  ): Promise<boolean> {
    const sql = `
      INSERT INTO product_changes (product_id, source, source_updated_at, payload, payload_hash)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (product_id, payload_hash) DO NOTHING
      RETURNING id
    `;
    const result = await tx.query<{ id: number }>(sql, [
      change.productId,
      change.source,
      change.sourceUpdatedAt,
      JSON.stringify(change.payload),
      change.payloadHash,
    ]);

    return result.rows.length > 0;
  }

  public async listChanges(
    client: DatabaseClient,
    productId?: string
  ): Promise<ProductChangeRecord[]> {
    let sql = `
      SELECT id, product_id, source, source_updated_at, payload, payload_hash, created_at
      FROM product_changes
    `;
    const params: unknown[] = [];

    if (productId) {
      sql += " WHERE product_id = $1";
      params.push(productId);
    }

    sql += " ORDER BY source_updated_at DESC, id DESC";

    const result = await client.query<DbProductChangeRow>(sql, params);
    return result.rows.map((r) => this.mapRowToRecord(r));
  }
}
