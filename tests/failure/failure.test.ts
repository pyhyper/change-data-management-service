import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/cdms/src/app.js";
import { MemoryDatabaseClient } from "../../apps/cdms/src/db/memory-db.js";
import { NormalizedChange } from "../../apps/cdms/src/domain/models/change.model.js";

describe("Failure-Injection & Recovery Tests", () => {
  let db: MemoryDatabaseClient;
  let app: ReturnType<typeof createApp>["app"];
  let changeProcessor: ReturnType<typeof createApp>["changeProcessor"];

  beforeEach(() => {
    db = new MemoryDatabaseClient();
    const context = createApp(db);
    app = context.app;
    changeProcessor = context.changeProcessor;
  });

  // FT-01: Lost response retry scenario
  it("FT-01: When response is lost after DB commit, client retry with same key does not duplicate change", async () => {
    const payload = {
      id: "P-LOST-01",
      name: "Smart Watch",
      quantity: 12,
      price: 1500000,
      updatedAt: "2026-09-30T10:00:00Z",
    };

    // First request: succeeds in DB
    const res1 = await request(app)
      .post("/api/v1/webhooks/products")
      .set("Idempotency-Key", "evt-lost-resp-01")
      .send(payload);

    expect(res1.body.status).toBe("INSERTED");

    // Client lost response, so retries with same Idempotency-Key
    const res2 = await request(app)
      .post("/api/v1/webhooks/products")
      .set("Idempotency-Key", "evt-lost-resp-01")
      .send(payload);

    expect(res2.body.status).toBe("DUPLICATE_EVENT");

    // Assert only 1 change in database
    const changes = await db.query("SELECT * FROM product_changes WHERE product_id = $1", ["P-LOST-01"]);
    expect(changes.rows.length).toBe(1);
  });

  // FT-02: Crash before commit rolls back cleanly
  it("FT-02: Failure before commit must rollback completely and allow safe subsequent retry", async () => {
    const change: NormalizedChange = {
      productId: "P-CRASH-01",
      source: "WEBHOOK",
      sourceUpdatedAt: new Date("2026-09-30T10:00:00Z"),
      payload: { id: "P-CRASH-01", updatedAt: "2026-09-30T10:00:00Z" },
      payloadHash: "hash-crash-01",
      idempotencyKey: "evt-crash-01",
    };

    // Simulate unexpected crash during transaction
    try {
      await db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO ingestion_events (idempotency_key, source, payload_hash, status) VALUES ($1, $2, $3, $4)",
          [change.idempotencyKey, change.source, change.payloadHash, "PROCESSING"]
        );
        // Crash before commit
        throw new Error("Simulated sudden network/node failure");
      });
    } catch {
      // Caught simulated crash
    }

    // Assert nothing was committed to ingestion_events
    const events = await db.query("SELECT * FROM ingestion_events WHERE idempotency_key = $1", ["evt-crash-01"]);
    expect(events.rows.length).toBe(0);

    // Subsequent retry succeeds normally
    const result = await changeProcessor.processChange(change);
    expect(result.status).toBe("INSERTED");

    const finalChanges = await db.query("SELECT * FROM product_changes WHERE product_id = $1", ["P-CRASH-01"]);
    expect(finalChanges.rows.length).toBe(1);
  });
});
