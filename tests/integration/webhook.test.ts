import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/cdms/src/app.js";
import { MemoryDatabaseClient } from "../../apps/cdms/src/db/memory-db.js";

describe("Webhook Ingestion Integration Tests", () => {
  let db: MemoryDatabaseClient;
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    db = new MemoryDatabaseClient();
    const context = createApp(db);
    app = context.app;
  });

  it("should process webhook and insert new product change", async () => {
    const payload = {
      id: "P-101",
      name: "Wireless Mouse",
      quantity: 50,
      price: 150000,
      updatedAt: "2026-09-30T10:00:00Z",
    };

    const res = await request(app)
      .post("/api/v1/webhooks/products")
      .set("Idempotency-Key", "evt-mouse-01")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("INSERTED");
    expect(res.body.productId).toBe("P-101");
  });

  it("should return DUPLICATE_EVENT when retrying with identical Idempotency-Key", async () => {
    const payload = {
      id: "P-102",
      name: "Mechanical Keyboard",
      quantity: 20,
      price: 850000,
      updatedAt: "2026-09-30T10:00:00Z",
    };

    // First attempt
    const res1 = await request(app)
      .post("/api/v1/webhooks/products")
      .set("Idempotency-Key", "evt-kbd-01")
      .send(payload);
    expect(res1.body.status).toBe("INSERTED");

    // Retry identical request
    const res2 = await request(app)
      .post("/api/v1/webhooks/products")
      .set("Idempotency-Key", "evt-kbd-01")
      .send(payload);
    expect(res2.body.status).toBe("DUPLICATE_EVENT");

    // Verify DB still only has 1 record
    const history = await request(app).get("/api/v1/products/P-102/history");
    expect(history.body.totalChanges).toBe(1);
  });

  it("should detect NO_CHANGE if payload is identical under different idempotency key", async () => {
    const payload = {
      id: "P-103",
      name: "Monitor Stand",
      quantity: 15,
      price: 300000,
      updatedAt: "2026-09-30T10:00:00Z",
    };

    // First request
    await request(app)
      .post("/api/v1/webhooks/products")
      .set("Idempotency-Key", "evt-ms-01")
      .send(payload);

    // Second request with different event key but same product content and timestamp
    const res2 = await request(app)
      .post("/api/v1/webhooks/products")
      .set("Idempotency-Key", "evt-ms-02")
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe("NO_CHANGE");

    const history = await request(app).get("/api/v1/products/P-103/history");
    expect(history.body.totalChanges).toBe(1);
  });

  it("should return STALE if incoming update is older than the latest state", async () => {
    // 1. Insert newer version
    await request(app)
      .post("/api/v1/webhooks/products")
      .set("Idempotency-Key", "evt-stale-02")
      .send({
        id: "P-104",
        quantity: 100,
        price: 500000,
        updatedAt: "2026-09-30T11:00:00Z",
      });

    // 2. Incoming older version arrives late
    const res = await request(app)
      .post("/api/v1/webhooks/products")
      .set("Idempotency-Key", "evt-stale-01")
      .send({
        id: "P-104",
        quantity: 80,
        price: 450000,
        updatedAt: "2026-09-30T10:00:00Z",
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("STALE");

    // History should keep only the latest version
    const history = await request(app).get("/api/v1/products/P-104/history");
    expect(history.body.totalChanges).toBe(1);
    expect(history.body.changes[0].payload.quantity).toBe(100);
  });

  it("should reject payload missing required fields with HTTP 400", async () => {
    const invalidPayload = {
      // missing id and updatedAt
      name: "Invalid item",
      price: -50,
    };

    const res = await request(app)
      .post("/api/v1/webhooks/products")
      .send(invalidPayload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});
