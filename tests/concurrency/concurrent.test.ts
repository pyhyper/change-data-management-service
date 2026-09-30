import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import * as xlsx from "xlsx";
import { createApp } from "../../apps/cdms/src/app.js";
import { MemoryDatabaseClient } from "../../apps/cdms/src/db/memory-db.js";
import { NormalizedChange } from "../../apps/cdms/src/domain/models/change.model.js";
import { computePayloadHash, normalizeProduct } from "../../apps/cdms/src/processing/canonical/canonical.util.js";
import { derivePollingIdempotencyKey } from "../../apps/cdms/src/processing/canonical/idempotency.util.js";
import { ChangeProcessor } from "../../apps/cdms/src/processing/pipeline/change.processor.js";

function createExcelBuffer(rows: Record<string, unknown>[]): Buffer {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("Concurrency Tests — Exactness & Idempotency", () => {
  let db: MemoryDatabaseClient;
  let app: ReturnType<typeof createApp>["app"];
  let changeProcessor: ChangeProcessor;

  beforeEach(() => {
    db = new MemoryDatabaseClient();
    const context = createApp(db);
    app = context.app;
    changeProcessor = context.changeProcessor;
  });

  // CT-01: Same event x100
  it("CT-01: 100 concurrent requests with same Idempotency-Key should yield exactly 1 DB effect", async () => {
    const payload = {
      id: "CONCUR-01",
      name: "Concurrent Item",
      quantity: 50,
      price: 100000,
      updatedAt: "2026-09-30T10:00:00Z",
    };

    const requests = Array.from({ length: 100 }, () =>
      request(app)
        .post("/api/v1/webhooks/products")
        .set("Idempotency-Key", "same-event-key-100")
        .send(payload)
    );

    const responses = await Promise.all(requests);

    const insertedCount = responses.filter((r) => r.body.status === "INSERTED").length;
    const duplicateCount = responses.filter((r) => r.body.status === "DUPLICATE_EVENT").length;

    expect(insertedCount).toBe(1);
    expect(duplicateCount).toBe(99);

    const dbChanges = await db.query("SELECT * FROM product_changes WHERE product_id = $1", ["CONCUR-01"]);
    expect(dbChanges.rows.length).toBe(1);
  });

  // CT-02: Same product concurrently from 3 sources (Webhook, Poll, Excel)
  it("CT-02: Same product concurrently submitted from 3 sources should produce exactly 1 change", async () => {
    const rawData = {
      id: "TRI-SOURCE-01",
      sku: "SKU-TRI-1",
      name: "Tri Source Item",
      quantity: 40,
      price: 250000,
      updatedAt: "2026-09-30T10:00:00Z",
    };

    // 1. Webhook request promise
    const webhookPromise = request(app)
      .post("/api/v1/webhooks/products")
      .send(rawData);

    // 2. Excel request promise
    const excelBuffer = createExcelBuffer([rawData]);
    const excelPromise = request(app)
      .post("/api/v1/imports/products/excel")
      .attach("file", excelBuffer, "tri_source.xlsx");

    // 3. Polling processor promise
    const normalized = normalizeProduct(rawData);
    const hash = computePayloadHash(normalized);
    const pollingChange: NormalizedChange = {
      productId: normalized.id,
      source: "POLL",
      sourceUpdatedAt: new Date(normalized.updatedAt),
      payload: normalized,
      payloadHash: hash,
      idempotencyKey: derivePollingIdempotencyKey(normalized.id, normalized.updatedAt, hash),
    };
    const pollingPromise = changeProcessor.processChange(pollingChange);

    // Run all 3 concurrently
    const [webhookRes, excelRes, pollingRes] = await Promise.all([
      webhookPromise,
      excelPromise,
      pollingPromise,
    ]);

    expect(webhookRes.status).toBe(200);
    expect(excelRes.status).toBe(200);
    expect(pollingRes).toBeDefined();

    // Verify database only has 1 record for this product
    const changes = await db.query("SELECT * FROM product_changes WHERE product_id = $1", ["TRI-SOURCE-01"]);
    expect(changes.rows.length).toBe(1);
  });

  // CT-03: Ordered changes v1 -> v2 -> v3
  it("CT-03: Ordered sequence v1, v2, v3 should insert 3 distinct states", async () => {
    const v1 = { id: "P-SEQ", quantity: 10, updatedAt: "2026-09-30T10:00:00Z" };
    const v2 = { id: "P-SEQ", quantity: 20, updatedAt: "2026-09-30T10:05:00Z" };
    const v3 = { id: "P-SEQ", quantity: 30, updatedAt: "2026-09-30T10:10:00Z" };

    const res1 = await request(app).post("/api/v1/webhooks/products").send(v1);
    const res2 = await request(app).post("/api/v1/webhooks/products").send(v2);
    const res3 = await request(app).post("/api/v1/webhooks/products").send(v3);

    expect(res1.body.status).toBe("INSERTED");
    expect(res2.body.status).toBe("INSERTED");
    expect(res3.body.status).toBe("INSERTED");

    const history = await request(app).get("/api/v1/products/P-SEQ/history");
    expect(history.body.totalChanges).toBe(3);
  });

  // CT-04: Stale arrival (v2 arrives first, then v1 arrives later)
  it("CT-04: When newer state arrives first, late older state must be classified as STALE", async () => {
    const v2 = { id: "P-STALE-CHECK", quantity: 20, updatedAt: "2026-09-30T10:05:00Z" };
    const v1 = { id: "P-STALE-CHECK", quantity: 10, updatedAt: "2026-09-30T10:00:00Z" };

    // v2 arrives first
    const resV2 = await request(app).post("/api/v1/webhooks/products").send(v2);
    expect(resV2.body.status).toBe("INSERTED");

    // v1 arrives later
    const resV1 = await request(app).post("/api/v1/webhooks/products").send(v1);
    expect(resV1.body.status).toBe("STALE");

    // Database still holds only 1 record (the newer v2)
    const history = await request(app).get("/api/v1/products/P-STALE-CHECK/history");
    expect(history.body.totalChanges).toBe(1);
    expect(history.body.changes[0].payload.quantity).toBe(20);
  });
});
