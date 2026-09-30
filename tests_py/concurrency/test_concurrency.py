import asyncio
import io
from datetime import datetime, timezone
import openpyxl
import pytest
from httpx import ASGITransport, AsyncClient
from src.cdms.db.memory_db import MemoryDatabaseClient
from src.cdms.domain.models import NormalizedChange
from src.cdms.main import create_app
from src.cdms.processing.canonical import compute_payload_hash, normalize_product
from src.cdms.processing.idempotency import derive_polling_idempotency_key

def make_excel(rows: list[dict]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    assert ws is not None
    headers = list(rows[0].keys())
    ws.append(headers)
    for r in rows:
        ws.append([r.get(h) for h in headers])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()

@pytest.mark.asyncio
async def test_concurrency_scenarios():
    db = MemoryDatabaseClient()
    app = create_app(custom_db=db)
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # CT-01: 100 concurrent requests with same key -> 1 INSERTED, 99 DUPLICATE_EVENT
        payload = {
            "id": "CONCUR-1",
            "name": "Item",
            "quantity": 50,
            "updatedAt": "2026-09-30T10:00:00Z",
        }

        async def send_req():
            return await client.post(
                "/api/v1/webhooks/products",
                json=payload,
                headers={"Idempotency-Key": "same-concur-key"}
            )

        responses = await asyncio.gather(*(send_req() for _ in range(100)))
        inserted = sum(1 for r in responses if r.json().get("status") == "INSERTED")
        duplicated = sum(1 for r in responses if r.json().get("status") == "DUPLICATE_EVENT")

        assert inserted == 1
        assert duplicated == 99
        assert len(await db.list_product_changes("CONCUR-1")) == 1

        # CT-02: Same product concurrently from 3 sources
        raw_tri = {
            "id": "TRI-1",
            "name": "Tri Item",
            "quantity": 30,
            "price": 100000,
            "updatedAt": "2026-09-30T10:00:00Z",
        }

        async def call_webhook():
            return await client.post("/api/v1/webhooks/products", json=raw_tri)

        async def call_excel():
            f_bytes = make_excel([raw_tri])
            files = {"file": ("tri.xlsx", f_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
            return await client.post("/api/v1/imports/products/excel", files=files)

        async def call_polling():
            norm = normalize_product(raw_tri)
            h = compute_payload_hash(norm)
            k = derive_polling_idempotency_key(norm["id"], norm["updatedAt"], h)
            change = NormalizedChange(
                product_id=norm["id"],
                source="POLL",
                source_updated_at=datetime.fromisoformat(norm["updatedAt"].replace("Z", "+00:00")),
                payload=norm,
                payload_hash=h,
                idempotency_key=k,
            )
            return await app.state.change_processor.process_change(change)

        await asyncio.gather(call_webhook(), call_excel(), call_polling())
        # Exactly 1 change record in DB
        assert len(await db.list_product_changes("TRI-1")) == 1

        # CT-03: Ordered sequence v1, v2, v3
        v1 = {"id": "SEQ-1", "quantity": 10, "updatedAt": "2026-09-30T10:00:00Z"}
        v2 = {"id": "SEQ-1", "quantity": 20, "updatedAt": "2026-09-30T10:05:00Z"}
        v3 = {"id": "SEQ-1", "quantity": 30, "updatedAt": "2026-09-30T10:10:00Z"}

        r_v1 = await client.post("/api/v1/webhooks/products", json=v1)
        r_v2 = await client.post("/api/v1/webhooks/products", json=v2)
        r_v3 = await client.post("/api/v1/webhooks/products", json=v3)

        assert r_v1.json()["status"] == "INSERTED"
        assert r_v2.json()["status"] == "INSERTED"
        assert r_v3.json()["status"] == "INSERTED"
        assert len(await db.list_product_changes("SEQ-1")) == 3

        # CT-04: Stale arrival
        newer = {"id": "STALE-1", "quantity": 20, "updatedAt": "2026-09-30T10:05:00Z"}
        older = {"id": "STALE-1", "quantity": 10, "updatedAt": "2026-09-30T10:00:00Z"}

        res_new = await client.post("/api/v1/webhooks/products", json=newer)
        res_old = await client.post("/api/v1/webhooks/products", json=older)

        assert res_new.json()["status"] == "INSERTED"
        assert res_old.json()["status"] == "STALE"
        changes = await db.list_product_changes("STALE-1")
        assert len(changes) == 1
        assert changes[0]["payload"]["quantity"] == 20
