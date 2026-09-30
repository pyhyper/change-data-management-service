from datetime import datetime
from ..domain.models import PollingCheckpointRecord

class CheckpointRepository:
    def __init__(self, db):
        self.db = db

    async def get_checkpoint(self, source: str) -> PollingCheckpointRecord | None:
        data = await self.db.get_checkpoint(source)
        if not data:
            return None
        return PollingCheckpointRecord(
            source=data["source"],
            last_updated_at=data.get("last_updated_at"),
            cursor=data.get("cursor"),
            updated_at=data["updated_at"],
        )

    async def save_checkpoint(
        self,
        source: str,
        last_updated_at: datetime | None,
        cursor: str | None = None
    ) -> None:
        await self.db.save_checkpoint(source, last_updated_at, cursor)
