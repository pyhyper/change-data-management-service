import pytest
from httpx import ASGITransport, AsyncClient
from src.cdms.db.memory_db import MemoryDatabaseClient
from src.cdms.main import create_app

@pytest.mark.asyncio
async def test_webhook_ingestion_and_idempotency():
    db = MemoryDatabaseClient()
    app = create_app(custom_db=db)
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "id": "P-101",
            "name": "Wireless Mouse",
            "quantity": 50,
            "price": 150000,
            "updatedAt": "2026-09-30T10:00:00Z",
        }

        # 1. First webhook request -> INSERTED
        res1 = await client.post(
            "/api/v1/webhooks/products",
            json=payload,
            headers={"Idempotency-Key": "evt-mouse-01"}
        )
        assert res1.status_code == 200
        data1 = res1.json()
        assert data1["status"] == "INSERTED"
        assert data1["productId"] == "P-101"

        # 2. Retry with same Idempotency-Key -> DUPLICATE_EVENT
        res2 = await client.post(
            "/api/v1/webhooks/products",
            json=payload,
            headers={"Idempotency-Key": "evt-mouse-01"}
        )
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["status"] == "DUPLICATE_EVENT"

        # Verify only 1 change record in DB
        res_hist = await client.get("/api/v1/products/P-101/history")
        assert res_hist.json()["totalChanges"] == 1

        # 3. New event key but identical content -> NO_CHANGE
        res3 = await client.post(
            "/api/v1/webhooks/products",
            json=payload,
            headers={"Idempotency-Key": "evt-mouse-02"}
        )
        assert res3.status_code == 200
        assert res3.json()["status"] == "NO_CHANGE"
        assert (await client.get("/api/v1/products/P-101/history")).json()["totalChanges"] == 1

        # 4. Stale arrival -> STALE
        stale_payload = {
            "id": "P-101",
            "quantity": 30,
            "updatedAt": "2026-09-30T09:00:00Z",
        }
        res4 = await client.post(
            "/api/v1/webhooks/products",
            json=stale_payload,
            headers={"Idempotency-Key": "evt-stale"}
        )
        assert res4.status_code == 200
        assert res4.json()["status"] == "STALE"

        # 5. Invalid payload -> 400 Bad Request
        res5 = await client.post("/api/v1/webhooks/products", json={"name": "No ID"})
        assert res5.status_code == 400
        assert res5.json()["success"] is False
