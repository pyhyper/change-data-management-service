import asyncio
import random
from datetime import datetime, timezone
from typing import Any
import httpx
from ..domain.exceptions import ExternalServiceException
from ..domain.models import NormalizedChange
from ..processing.canonical import compute_payload_hash, normalize_product
from ..processing.idempotency import derive_polling_idempotency_key
from ..processing.pipeline import ChangeProcessor
from ..repositories.checkpoint_repo import CheckpointRepository

class InventoryClient:
    def __init__(self, base_url: str, timeout: float = 5.0, max_retries: int = 3):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries

    async def fetch_changed_products(
        self,
        updated_since: datetime | None = None,
        limit: int = 100
    ) -> list[dict[str, Any]]:
        url = f"{self.base_url}/api/v1/products"
        params: dict[str, Any] = {"limit": limit}
        if updated_since:
            params["updatedSince"] = updated_since.isoformat()

        attempt = 0
        delay = 0.25

        while attempt <= self.max_retries:
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    resp = await client.get(url, params=params)
                    if resp.status_code >= 400:
                        raise ExternalServiceException(f"Inventory HTTP {resp.status_code}: {resp.text}")
                    data = resp.json()
                    if isinstance(data, list):
                        return data
                    return data.get("products", [])
            except Exception as e:
                attempt += 1
                if attempt > self.max_retries:
                    raise ExternalServiceException(f"Failed to query Inventory Service: {str(e)}")
                jitter = random.uniform(0, 0.1)
                await asyncio.sleep(delay + jitter)
                delay *= 2

        return []

class PollingScheduler:
    def __init__(
        self,
        db,
        inventory_client: InventoryClient,
        change_processor: ChangeProcessor,
        checkpoint_repo: CheckpointRepository | None = None,
        interval_seconds: float = 10.0,
        source_name: str = "INVENTORY_SERVICE"
    ):
        self.db = db
        self.inventory_client = inventory_client
        self.change_processor = change_processor
        self.checkpoint_repo = checkpoint_repo or CheckpointRepository(db)
        self.interval_seconds = interval_seconds
        self.source_name = source_name
        self.is_running = False
        self._task: asyncio.Task | None = None

    async def poll_once(self) -> dict[str, Any]:
        checkpoint = await self.checkpoint_repo.get_checkpoint(self.source_name)
        last_updated = checkpoint.last_updated_at if checkpoint else None

        products = await self.inventory_client.fetch_changed_products(
            updated_since=last_updated,
            limit=100
        )

        if not products:
            return {
                "fetched_count": 0,
                "processed_count": 0,
                "results": [],
                "checkpoint": last_updated,
            }

        results = []
        max_updated = last_updated

        for raw in products:
            normalized = normalize_product(raw)
            payload_hash = compute_payload_hash(normalized)
            idempotency_key = derive_polling_idempotency_key(
                normalized["id"],
                normalized["updatedAt"],
                payload_hash
            )
            prod_dt = datetime.fromisoformat(normalized["updatedAt"].replace("Z", "+00:00"))
            change = NormalizedChange(
                product_id=normalized["id"],
                source="POLL",
                source_updated_at=prod_dt,
                payload=normalized,
                payload_hash=payload_hash,
                idempotency_key=idempotency_key,
            )
            res = await self.change_processor.process_change(change)
            results.append(res)

            if max_updated is None or prod_dt > max_updated:
                max_updated = prod_dt

        # Advance checkpoint only after batch succeeds safely
        if max_updated and (last_updated is None or max_updated > last_updated):
            await self.checkpoint_repo.save_checkpoint(self.source_name, max_updated)

        return {
            "fetched_count": len(products),
            "processed_count": len(results),
            "results": results,
            "checkpoint": max_updated,
        }

    def start(self) -> None:
        if self.is_running:
            return
        self.is_running = True

        async def _loop():
            while self.is_running:
                try:
                    await self.poll_once()
                except Exception:
                    pass
                await asyncio.sleep(self.interval_seconds)

        self._task = asyncio.create_task(_loop())

    def stop(self) -> None:
        self.is_running = False
        if self._task and not self._task.done():
            self._task.cancel()
