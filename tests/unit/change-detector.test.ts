import { describe, expect, it } from "vitest";
import { NormalizedChange, ProductChangeRecord } from "../../apps/cdms/src/domain/models/change.model.js";
import { ChangeDetector } from "../../apps/cdms/src/processing/detector/change-detector.js";

describe("ChangeDetector Unit Tests", () => {
  const detector = new ChangeDetector();

  const createMockIncoming = (
    productId: string,
    updatedAt: string,
    hash: string
  ): NormalizedChange => ({
    productId,
    source: "WEBHOOK",
    sourceUpdatedAt: new Date(updatedAt),
    payload: { id: productId, quantity: 10, updatedAt },
    payloadHash: hash,
    idempotencyKey: `KEY-${productId}-${hash}`,
  });

  const createMockLatest = (
    productId: string,
    updatedAt: string,
    hash: string
  ): ProductChangeRecord => ({
    id: 1,
    productId,
    source: "WEBHOOK",
    sourceUpdatedAt: new Date(updatedAt),
    payload: { id: productId, quantity: 10, updatedAt },
    payloadHash: hash,
    createdAt: new Date(),
  });

  it("should return INSERTED when no previous product record exists", () => {
    const incoming = createMockIncoming("PROD-1", "2026-09-30T10:00:00Z", "hash1");
    const result = detector.evaluate(null, incoming);

    expect(result.status).toBe("INSERTED");
    expect(result.hasChanged).toBe(true);
  });

  it("should return NO_CHANGE when payload hash is identical to latest record", () => {
    const latest = createMockLatest("PROD-1", "2026-09-30T10:00:00Z", "same-hash");
    const incoming = createMockIncoming("PROD-1", "2026-09-30T10:05:00Z", "same-hash");

    const result = detector.evaluate(latest, incoming);
    expect(result.status).toBe("NO_CHANGE");
    expect(result.hasChanged).toBe(false);
  });

  it("should return STALE when incoming updatedAt is older than latest record", () => {
    const latest = createMockLatest("PROD-1", "2026-09-30T10:00:00Z", "hash-new");
    const incoming = createMockIncoming("PROD-1", "2026-09-30T09:00:00Z", "hash-old");

    const result = detector.evaluate(latest, incoming);
    expect(result.status).toBe("STALE");
    expect(result.hasChanged).toBe(false);
  });

  it("should return INSERTED when incoming is newer and has different hash", () => {
    const latest = createMockLatest("PROD-1", "2026-09-30T10:00:00Z", "hash-old");
    const incoming = createMockIncoming("PROD-1", "2026-09-30T10:15:00Z", "hash-new");

    const result = detector.evaluate(latest, incoming);
    expect(result.status).toBe("INSERTED");
    expect(result.hasChanged).toBe(true);
  });
});
