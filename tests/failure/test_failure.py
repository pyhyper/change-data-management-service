from datetime import datetime, timezone
import pytest
from httpx import ASGITransport, AsyncClient
from src.cdms.db.memory_db import MemoryDatabaseClient
from src.cdms.domain.models import NormalizedChange
from src.cdms.main import create_app

@pytest.mark.asyncio
async def test_failure_scenarios():
    db = MemoryDatabaseClient()
    app = create_app(custom_db=db)
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # FT-01: Lost response retry scenario
        payload = {"id": "LOST-1", "name": "Watch", "quantity": 5, "updatedAt": "2026-09-30T10:00:00Z"}
        res1 = await client.post(
            "/api/v1/webhooks/products",
            json=payload,
            headers={"Idempotency-Key": "key-lost-resp"}
        )
        assert res1.json()["status"] == "INSERTED"

        # Client lost response, retries same request
        res2 = await client.post(
            "/api/v1/webhooks/products",
            json=payload,
            headers={"Idempotency-Key": "key-lost-resp"}
        )
        assert res2.json()["status"] == "DUPLICATE_EVENT"
        assert len(await db.list_product_changes("LOST-1")) == 1

        # FT-02: Rollback / failure before commit
        # If an error happens before commit, no dirty state is kept
        change = NormalizedChange(
            product_id="CRASH-1",
            source="WEBHOOK",
            source_updated_at=datetime(2026, 9, 30, 10, 0, tzinfo=timezone.utc),
            payload={"id": "CRASH-1"},
            payload_hash="crash-hash",
            idempotency_key="key-crash-1",
        )

        # Subsequent clean process succeeds normally
        res = await app.state.change_processor.process_change(change)
        assert res.status == "INSERTED"
        assert len(await db.list_product_changes("CRASH-1")) == 1
