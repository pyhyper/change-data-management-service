import { createHash } from "node:crypto";
import { ProductPayload } from "../../domain/models/change.model.js";
import { ProductSchema } from "../../domain/schemas/product.schema.js";

export function sortKeysRecursively(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortKeysRecursively);
  }

  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const sortedObj: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    const val = record[key];
    if (val !== undefined) {
      sortedObj[key] = sortKeysRecursively(val);
    }
  }

  return sortedObj;
}

export function canonicalJson(value: object): string {
  return JSON.stringify(sortKeysRecursively(value));
}

export function computePayloadHash(payload: object): string {
  const canonicalString = canonicalJson(payload);
  return createHash("sha256").update(canonicalString).digest("hex");
}

export function normalizeProduct(input: unknown): ProductPayload {
  const parsed = ProductSchema.parse(input);

  const normalized: {
    id: string;
    sku?: string;
    name?: string;
    quantity?: number;
    price?: number;
    updatedAt: string;
  } = {
    id: parsed.id.trim(),
    updatedAt: new Date(parsed.updatedAt).toISOString(),
  };

  if (parsed.sku !== undefined) {
    normalized.sku = parsed.sku.trim();
  }
  if (parsed.name !== undefined) {
    normalized.name = parsed.name.trim();
  }
  if (parsed.quantity !== undefined) {
    normalized.quantity = Number(parsed.quantity);
  }
  if (parsed.price !== undefined) {
    normalized.price = Number(parsed.price);
  }

  return normalized;
}
