import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/cdms/src/app.js";
import { MemoryDatabaseClient } from "../../apps/cdms/src/db/memory-db.js";
import { InventoryClient } from "../../apps/cdms/src/ingestion/polling/inventory-client.js";
import { PollingScheduler } from "../../apps/cdms/src/ingestion/polling/polling-scheduler.js";
import { CheckpointRepository } from "../../apps/cdms/src/repositories/checkpoint.repository.js";
import { createEmulatorApp } from "../../apps/inventory-emulator/src/app.js";
import { ProductStore } from "../../apps/inventory-emulator/src/store/product-store.js";

describe("Scheduled Polling Integration Tests", () => {
  let db: MemoryDatabaseClient;
  let emulatorStore: ProductStore;
  let emulatorServer: http.Server;
  let emulatorPort: number;
  let inventoryClient: InventoryClient;
  let scheduler: PollingScheduler;

  beforeAll(async () => {
    emulatorStore = new ProductStore();
    const { app: emulatorApp } = createEmulatorApp(emulatorStore);

    await new Promise<void>((resolve) => {
      emulatorServer = emulatorApp.listen(0, () => {
        const addr = emulatorServer.address();
        if (typeof addr === "object" && addr) {
          emulatorPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => emulatorServer.close(() => resolve()));
  });

  beforeEach(() => {
    emulatorStore.clear();
    emulatorStore.setSimulateFailure(false);

    db = new MemoryDatabaseClient();
    const context = createApp(db);

    inventoryClient = new InventoryClient(`http://localhost:${emulatorPort}`, 2000, 1);
    scheduler = new PollingScheduler(
      db,
      inventoryClient,
      context.changeProcessor,
      new CheckpointRepository(),
      1000
    );
  });

  it("should fetch initial products and advance checkpoint", async () => {
    emulatorStore.add({
      id: "POLL-01",
      sku: "SKU-P1",
      name: "Office Chair",
      quantity: 10,
      price: 1200000,
      updatedAt: "2026-09-30T10:00:00Z",
    });
    emulatorStore.add({
      id: "POLL-02",
      sku: "SKU-P2",
      name: "Office Desk",
      quantity: 5,
      price: 2500000,
      updatedAt: "2026-09-30T10:05:00Z",
    });

    const result = await scheduler.pollOnce();
    expect(result.fetchedCount).toBe(2);
    expect(result.processedCount).toBe(2);
    expect(result.newCheckpoint?.toISOString()).toBe("2026-09-30T10:05:00.000Z");

    const changes = await db.query("SELECT * FROM product_changes");
    expect(changes.rows.length).toBe(2);
  });

  it("should not duplicate records on consecutive polls when no updates occurred", async () => {
    emulatorStore.add({
      id: "POLL-03",
      sku: "SKU-P3",
      name: "Webcam HD",
      quantity: 15,
      price: 800000,
      updatedAt: "2026-09-30T10:00:00Z",
    });

    // 1st Poll
    await scheduler.pollOnce();

    // 2nd Poll
    const result2 = await scheduler.pollOnce();
    expect(result2.fetchedCount).toBe(0);

    const changes = await db.query("SELECT * FROM product_changes");
    expect(changes.rows.length).toBe(1);
  });

  it("should only ingest updated products when inventory changes", async () => {
    emulatorStore.add({
      id: "POLL-04",
      sku: "SKU-P4",
      name: "USB Hub",
      quantity: 20,
      price: 200000,
      updatedAt: "2026-09-30T10:00:00Z",
    });

    await scheduler.pollOnce();

    // Update product quantity and timestamp
    emulatorStore.update("POLL-04", {
      quantity: 25,
      updatedAt: "2026-09-30T10:30:00Z",
    });

    const result2 = await scheduler.pollOnce();
    expect(result2.fetchedCount).toBe(1);
    expect(result2.results[0].status).toBe("INSERTED");

    // History should now have 2 versions
    const changes = await db.query("SELECT * FROM product_changes WHERE product_id = $1", ["POLL-04"]);
    expect(changes.rows.length).toBe(2);
  });

  it("should handle transient emulator failures without corrupting checkpoint", async () => {
    emulatorStore.setSimulateFailure(true);

    await expect(scheduler.pollOnce()).rejects.toThrow();

    const checkpoint = await new CheckpointRepository().getCheckpoint(db, "INVENTORY_SERVICE");
    expect(checkpoint).toBeNull();
  });
});
