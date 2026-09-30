import { env } from "../config/env.config.js";
import { MemoryDatabaseClient } from "./memory-db.js";
import { PostgresDatabaseClient } from "./postgres-db.js";
import { DatabaseClient } from "./types.js";

let defaultClient: DatabaseClient | null = null;

export function createDatabaseClient(customDbUrl?: string): DatabaseClient {
  const dbUrl = customDbUrl || env.DATABASE_URL;

  if (env.USE_IN_MEMORY_DB || !dbUrl) {
    return new MemoryDatabaseClient();
  }

  return new PostgresDatabaseClient(dbUrl);
}

export function getDatabaseClient(): DatabaseClient {
  if (!defaultClient) {
    defaultClient = createDatabaseClient();
  }
  return defaultClient;
}

export function setDatabaseClient(client: DatabaseClient): void {
  defaultClient = client;
}

export * from "./types.js";
export { MemoryDatabaseClient } from "./memory-db.js";
export { PostgresDatabaseClient } from "./postgres-db.js";
