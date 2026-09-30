import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { DatabaseClient, DatabaseTransaction, QueryResult } from "./types.js";

const { Pool } = pg;

export class PostgresDatabaseClient implements DatabaseClient {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  public async initMigrations(): Promise<void> {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationFile = path.join(currentDir, "migrations", "001_initial_schema.sql");
    if (fs.existsSync(migrationFile)) {
      const sql = fs.readFileSync(migrationFile, "utf-8");
      await this.pool.query(sql);
    }
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const res = await this.pool.query("SELECT 1");
      return res.rowCount === 1;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as T[] };
  }

  public async transaction<T>(action: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const tx: DatabaseTransaction = {
        query: async <R = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> => {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[] };
        },
        advisoryLock: async (productId: string): Promise<void> => {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [productId]);
        },
      };

      const result = await action(tx);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
