import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import * as xlsx from "xlsx";
import { createApp } from "../../apps/cdms/src/app.js";
import { MemoryDatabaseClient } from "../../apps/cdms/src/db/memory-db.js";

function createMockExcelBuffer(rows: Record<string, unknown>[]): Buffer {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("Excel Ingestion Integration Tests", () => {
  let db: MemoryDatabaseClient;
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    db = new MemoryDatabaseClient();
    const context = createApp(db);
    app = context.app;
  });

  it("should parse and ingest valid Excel file", async () => {
    const rows = [
      { id: "XLS-001", sku: "SKU-X1", name: "USB Cable", quantity: 50, price: 50000, updatedAt: "2026-09-30T10:00:00Z" },
      { id: "XLS-002", sku: "SKU-X2", name: "Power Bank", quantity: 30, price: 350000, updatedAt: "2026-09-30T10:00:00Z" },
    ];
    const buffer = createMockExcelBuffer(rows);

    const res = await request(app)
      .post("/api/v1/imports/products/excel")
      .attach("file", buffer, "products.xlsx");

    expect(res.status).toBe(200);
    expect(res.body.rows).toBe(2);
    expect(res.body.inserted).toBe(2);
    expect(res.body.invalid).toBe(0);
    expect(res.body.duplicate).toBe(0);
  });

  it("should detect duplicate rows upon re-uploading identical file", async () => {
    const rows = [
      { id: "XLS-003", sku: "SKU-X3", name: "Desk Lamp", quantity: 10, price: 200000, updatedAt: "2026-09-30T10:00:00Z" },
    ];
    const buffer = createMockExcelBuffer(rows);

    // 1st Upload
    const res1 = await request(app)
      .post("/api/v1/imports/products/excel")
      .attach("file", buffer, "products_lamp.xlsx");
    expect(res1.body.inserted).toBe(1);

    // 2nd Upload with identical file
    const res2 = await request(app)
      .post("/api/v1/imports/products/excel")
      .attach("file", buffer, "products_lamp.xlsx");

    expect(res2.status).toBe(200);
    expect(res2.body.inserted).toBe(0);
    expect(res2.body.duplicate).toBe(1);
  });

  it("should record invalid rows and continue processing remaining valid rows", async () => {
    const rows = [
      { id: "XLS-VALID", sku: "SKU-V", name: "Valid Item", quantity: 5, price: 100000, updatedAt: "2026-09-30T10:00:00Z" },
      { id: "", sku: "SKU-INV", name: "Missing ID", quantity: 5, price: 100000, updatedAt: "2026-09-30T10:00:00Z" },
      { id: "XLS-BAD-DATE", sku: "SKU-B", name: "Bad Date", quantity: 5, price: 100000, updatedAt: "not-a-date" },
    ];
    const buffer = createMockExcelBuffer(rows);

    const res = await request(app)
      .post("/api/v1/imports/products/excel")
      .attach("file", buffer, "mixed_products.xlsx");

    expect(res.status).toBe(200);
    expect(res.body.rows).toBe(3);
    expect(res.body.inserted).toBe(1);
    expect(res.body.invalid).toBe(2);
    expect(res.body.errors.length).toBe(2);
  });

  it("should reject corrupted or invalid files with HTTP 400", async () => {
    const corruptedBuffer = Buffer.from("Not a real excel zip file content");

    const res = await request(app)
      .post("/api/v1/imports/products/excel")
      .attach("file", corruptedBuffer, "corrupt.xlsx");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
