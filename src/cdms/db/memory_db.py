import asyncio
from datetime import datetime, timezone
from typing import Any

class MemoryDatabaseClient:
    def __init__(self):
        self.events: dict[str, dict[str, Any]] = {}
        self.changes: list[dict[str, Any]] = []
        self.checkpoints: dict[str, dict[str, Any]] = {}
        self.event_id_seq: int = 1
        self.change_id_seq: int = 1
        self.product_locks: dict[str, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()

    async def get_product_lock(self, product_id: str) -> asyncio.Lock:
        async with self._global_lock:
            if product_id not in self.product_locks:
                self.product_locks[product_id] = asyncio.Lock()
            return self.product_locks[product_id]

    async def is_healthy(self) -> bool:
        return True

    async def close(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.events.clear()
        self.changes.clear()
        self.checkpoints.clear()
        self.event_id_seq = 1
        self.change_id_seq = 1
        self.product_locks.clear()

    async def insert_event_if_absent(
        self,
        idempotency_key: str,
        source: str,
        payload_hash: str,
        status: str = "PROCESSING"
    ) -> bool:
        if idempotency_key in self.events:
            return False
        
        event_id = self.event_id_seq
        self.event_id_seq += 1
        self.events[idempotency_key] = {
            "id": event_id,
            "idempotency_key": idempotency_key,
            "source": source,
            "payload_hash": payload_hash,
            "status": status,
            "created_at": datetime.now(timezone.utc),
            "processed_at": None,
            "error_message": None,
        }
        return True

    async def mark_event_processed(
        self,
        idempotency_key: str,
        status: str,
        error_message: str | None = None
    ) -> None:
        if idempotency_key in self.events:
            self.events[idempotency_key]["status"] = status
            self.events[idempotency_key]["processed_at"] = datetime.now(timezone.utc)
            self.events[idempotency_key]["error_message"] = error_message

    async def get_latest_product_change(self, product_id: str) -> dict[str, Any] | None:
        matching = [c for c in self.changes if c["product_id"] == product_id]
        if not matching:
            return None
        matching.sort(key=lambda x: (x["source_updated_at"], x["id"]), reverse=True)
        return matching[0]

    async def insert_product_change(
        self,
        product_id: str,
        source: str,
        source_updated_at: datetime,
        payload: dict[str, Any],
        payload_hash: str
    ) -> bool:
        # Check unique constraint (product_id, payload_hash)
        duplicate = any(
            c["product_id"] == product_id and c["payload_hash"] == payload_hash
            for c in self.changes
        )
        if duplicate:
            return False

        change_id = self.change_id_seq
        self.change_id_seq += 1
        self.changes.append({
            "id": change_id,
            "product_id": product_id,
            "source": source,
            "source_updated_at": source_updated_at,
            "payload": payload,
            "payload_hash": payload_hash,
            "created_at": datetime.now(timezone.utc),
        })
        return True

    async def list_product_changes(self, product_id: str | None = None) -> list[dict[str, Any]]:
        if product_id:
            matching = [c for c in self.changes if c["product_id"] == product_id]
        else:
            matching = list(self.changes)
        matching.sort(key=lambda x: (x["source_updated_at"], x["id"]), reverse=True)
        return matching

    async def get_checkpoint(self, source: str) -> dict[str, Any] | None:
        return self.checkpoints.get(source)

    async def save_checkpoint(
        self,
        source: str,
        last_updated_at: datetime | None,
        cursor: str | None = None
    ) -> None:
        self.checkpoints[source] = {
            "source": source,
            "last_updated_at": last_updated_at,
            "cursor": cursor,
            "updated_at": datetime.now(timezone.utc),
        }
