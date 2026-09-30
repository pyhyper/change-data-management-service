from datetime import datetime, timezone
import pytest
from httpx import ASGITransport, AsyncClient
from src.cdms.db.memory_db import MemoryDatabaseClient
from src.cdms.ingestion.polling import InventoryClient, PollingScheduler
from src.cdms.processing.pipeline import ChangeProcessor
from src.cdms.repositories.checkpoint_repo import CheckpointRepository
from src.emulator.main import create_emulator_app
from src.emulator.store import ProductStore

@pytest.mark.asyncio
async def test_polling_scheduler_cycle():
    emulator_store = ProductStore()
    emulator_app = create_emulator_app(custom_store=emulator_store)

    transport = ASGITransport(app=emulator_app)
    # Mock client to route directly to ASGI transport
    class MockInventoryClient(InventoryClient):
        def __init__(self):
            super().__init__("http://emulator", timeout=2.0, max_retries=1)

        async def fetch_changed_products(self, updated_since=None, limit=100):
            async with AsyncClient(transport=transport, base_url="http://emulator") as client:
                params = {"limit": limit}
                if updated_since:
                    params["updatedSince"] = updated_since.isoformat()
                resp = await client.get("/api/v1/products", params=params)
                if resp.status_code >= 400:
                    raise Exception(f"HTTP {resp.status_code}")
                return resp.json()["products"]

    db = MemoryDatabaseClient()
    processor = ChangeProcessor(db)
    client = MockInventoryClient()
    checkpoint_repo = CheckpointRepository(db)
    scheduler = PollingScheduler(db, client, processor, checkpoint_repo)

    # Setup initial products
    emulator_store.clear()
    emulator_store.add({"id": "POLL-1", "name": "Item 1", "quantity": 10, "updatedAt": "2026-09-30T10:00:00Z"})
    emulator_store.add({"id": "POLL-2", "name": "Item 2", "quantity": 20, "updatedAt": "2026-09-30T10:05:00Z"})

    # 1st Poll
    res1 = await scheduler.poll_once()
    assert res1["fetched_count"] == 2
    assert res1["processed_count"] == 2
    assert len(await db.list_product_changes()) == 2

    # 2nd Poll (no new items) -> 0 fetched
    res2 = await scheduler.poll_once()
    assert res2["fetched_count"] == 0
    assert len(await db.list_product_changes()) == 2

    # Update item in emulator
    emulator_store.update("POLL-1", {"quantity": 15, "updatedAt": "2026-09-30T10:30:00Z"})

    # 3rd Poll -> fetches only updated item
    res3 = await scheduler.poll_once()
    assert res3["fetched_count"] == 1
    assert len(await db.list_product_changes("POLL-1")) == 2
