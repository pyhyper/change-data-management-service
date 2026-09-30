import io
import openpyxl
import pytest
from httpx import ASGITransport, AsyncClient
from src.cdms.db.memory_db import MemoryDatabaseClient
from src.cdms.main import create_app

def create_excel_buffer(rows: list[dict]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    assert ws is not None

    if not rows:
        ws.append(["id", "updatedAt"])
    else:
        headers = list(rows[0].keys())
        ws.append(headers)
        for r in rows:
            ws.append([r.get(h) for h in headers])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()

@pytest.mark.asyncio
async def test_excel_ingestion_and_deduplication():
    db = MemoryDatabaseClient()
    app = create_app(custom_db=db)
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Valid Excel upload
        rows = [
            {"id": "XLS-1", "sku": "SKU-1", "name": "Cable", "quantity": 10, "price": 50000, "updatedAt": "2026-09-30T10:00:00Z"},
            {"id": "XLS-2", "sku": "SKU-2", "name": "Adapter", "quantity": 20, "price": 150000, "updatedAt": "2026-09-30T10:00:00Z"},
        ]
        file_bytes = create_excel_buffer(rows)

        files = {"file": ("products.xlsx", file_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        res1 = await client.post("/api/v1/imports/products/excel", files=files)
        assert res1.status_code == 200
        d1 = res1.json()
        assert d1["rows"] == 2
        assert d1["inserted"] == 2
        assert d1["duplicate"] == 0

        # 2. Re-upload identical file -> duplicates detected
        files2 = {"file": ("products.xlsx", file_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        res2 = await client.post("/api/v1/imports/products/excel", files=files2)
        assert res2.status_code == 200
        d2 = res2.json()
        assert d2["inserted"] == 0
        assert d2["duplicate"] == 2

        # 3. Mixed valid & invalid rows
        mixed_rows = [
            {"id": "XLS-3", "name": "Valid Item", "updatedAt": "2026-09-30T10:00:00Z"},
            {"id": "", "name": "Empty ID", "updatedAt": "2026-09-30T10:00:00Z"},
            {"id": "XLS-4", "name": "Bad Date", "updatedAt": "not-valid-date"},
        ]
        mixed_bytes = create_excel_buffer(mixed_rows)
        files3 = {"file": ("mixed.xlsx", mixed_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        res3 = await client.post("/api/v1/imports/products/excel", files=files3)
        assert res3.status_code == 200
        d3 = res3.json()
        assert d3["rows"] == 3
        assert d3["inserted"] == 1
        assert d3["invalid"] == 2

        # 4. Corrupted file rejected
        bad_files = {"file": ("bad.xlsx", b"not a zip file", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        res4 = await client.post("/api/v1/imports/products/excel", files=bad_files)
        assert res4.status_code == 400
