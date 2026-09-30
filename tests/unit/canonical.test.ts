import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  computePayloadHash,
  normalizeProduct,
  sortKeysRecursively,
} from "../../apps/cdms/src/processing/canonical/canonical.util.js";
import {
  deriveExcelIdempotencyKey,
  derivePollingIdempotencyKey,
  deriveWebhookIdempotencyKey,
} from "../../apps/cdms/src/processing/canonical/idempotency.util.js";

describe("Canonicalization & Hash Utilities", () => {
  it("should sort object keys recursively regardless of insertion order", () => {
    const objA = { z: 1, a: { y: 2, b: 3 } };
    const objB = { a: { b: 3, y: 2 }, z: 1 };

    expect(sortKeysRecursively(objA)).toEqual({ a: { b: 3, y: 2 }, z: 1 });
    expect(canonicalJson(objA)).toEqual(canonicalJson(objB));
    expect(computePayloadHash(objA)).toEqual(computePayloadHash(objB));
  });

  it("should normalize product fields: trim strings, parse numbers, format UTC date", () => {
    const raw = {
      id: "  PROD-100  ",
      sku: "  SKU-ABC  ",
      name: "  Laptop Stand  ",
      quantity: "15",
      price: "250000",
      updatedAt: "2026-09-30 08:30:00Z",
    };

    const normalized = normalizeProduct(raw);
    expect(normalized).toEqual({
      id: "PROD-100",
      sku: "SKU-ABC",
      name: "Laptop Stand",
      quantity: 15,
      price: 250000,
      updatedAt: "2026-09-30T08:30:00.000Z",
    });
  });

  it("should produce deterministic hashes for identical normalized products", () => {
    const prod1 = normalizeProduct({ id: "P-1", updatedAt: "2026-09-30T00:00:00Z", quantity: 10 });
    const prod2 = normalizeProduct({ updatedAt: "2026-09-30T00:00:00Z", id: "P-1", quantity: 10 });

    expect(computePayloadHash(prod1)).toBe(computePayloadHash(prod2));
  });

  it("should correctly derive idempotency keys for Webhook, Polling, and Excel", () => {
    const hash = "abc123hash";
    const date = "2026-09-30T00:00:00.000Z";

    // Webhook with client key
    expect(deriveWebhookIdempotencyKey("P-1", date, hash, "custom-evt-99")).toBe("custom-evt-99");
    // Webhook without client key
    expect(deriveWebhookIdempotencyKey("P-1", date, hash)).toBe(`WEBHOOK:P-1:${date}:${hash}`);

    // Polling key
    expect(derivePollingIdempotencyKey("P-1", date, hash)).toBe(`POLL:P-1:${date}:${hash}`);

    // Excel key
    expect(deriveExcelIdempotencyKey("filehash1", 5, "P-1", hash)).toBe("EXCEL:filehash1:5:P-1:abc123hash");
  });
});
