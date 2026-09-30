import { createHash } from "node:crypto";

export function deriveWebhookIdempotencyKey(
  productId: string,
  updatedAt: string,
  payloadHash: string,
  clientKey?: string
): string {
  if (clientKey && clientKey.trim().length > 0) {
    return clientKey.trim();
  }
  return `WEBHOOK:${productId}:${updatedAt}:${payloadHash}`;
}

export function derivePollingIdempotencyKey(
  productId: string,
  updatedAt: string,
  payloadHash: string
): string {
  return `POLL:${productId}:${updatedAt}:${payloadHash}`;
}

export function deriveExcelIdempotencyKey(
  fileHash: string,
  rowNumber: number,
  productId: string,
  payloadHash: string
): string {
  return `EXCEL:${fileHash}:${rowNumber}:${productId}:${payloadHash}`;
}

export function computeBufferHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").substring(0, 16);
}
