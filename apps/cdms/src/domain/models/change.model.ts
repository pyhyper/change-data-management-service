export type IngestionSource = "POLL" | "WEBHOOK" | "EXCEL";

export type ProcessStatus = "INSERTED" | "DUPLICATE_EVENT" | "NO_CHANGE" | "STALE";

export interface ProductPayload {
  readonly id: string;
  readonly sku?: string;
  readonly name?: string;
  readonly quantity?: number;
  readonly price?: number;
  readonly updatedAt: string;
}

export interface NormalizedChange {
  readonly productId: string;
  readonly source: IngestionSource;
  readonly sourceUpdatedAt: Date;
  readonly payload: ProductPayload;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
}

export interface ProcessResult {
  readonly status: ProcessStatus;
  readonly productId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly message?: string;
}

export interface ProductChangeRecord {
  readonly id: number;
  readonly productId: string;
  readonly source: IngestionSource;
  readonly sourceUpdatedAt: Date;
  readonly payload: ProductPayload;
  readonly payloadHash: string;
  readonly createdAt: Date;
}

export interface IngestionEventRecord {
  readonly id: number;
  readonly idempotencyKey: string;
  readonly source: IngestionSource;
  readonly payloadHash: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly processedAt?: Date | null;
  readonly errorMessage?: string | null;
}

export interface PollingCheckpointRecord {
  readonly source: string;
  readonly lastUpdatedAt?: Date | null;
  readonly cursor?: string | null;
  readonly updatedAt: Date;
}
