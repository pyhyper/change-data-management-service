from ..domain.models import NormalizedChange

class IdempotencyRepository:
    def __init__(self, db):
        self.db = db

    async def insert_event_if_absent(self, change: NormalizedChange) -> bool:
        return await self.db.insert_event_if_absent(
            idempotency_key=change.idempotency_key,
            source=change.source,
            payload_hash=change.payload_hash,
            status="PROCESSING"
        )

    async def mark_event_processed(
        self,
        idempotency_key: str,
        status: str,
        error_message: str | None = None
    ) -> None:
        await self.db.mark_event_processed(
            idempotency_key=idempotency_key,
            status=status,
            error_message=error_message
        )
