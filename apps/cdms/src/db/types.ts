export interface QueryResult<T = unknown> {
  rows: T[];
}

export interface DatabaseTransaction {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  advisoryLock(productId: string): Promise<void>;
}

export interface DatabaseClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  transaction<T>(action: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
}
