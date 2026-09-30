from ..domain.models import NormalizedChange, ProcessResult
from ..repositories.change_repo import ChangeRepository
from ..repositories.idempotency_repo import IdempotencyRepository
from .detector import ChangeDetector

class ChangeProcessor:
    def __init__(
        self,
        db,
        idempotency_repo: IdempotencyRepository | None = None,
        change_repo: ChangeRepository | None = None,
        detector: ChangeDetector | None = None
    ):
        self.db = db
        self.idempotency_repo = idempotency_repo or IdempotencyRepository(db)
        self.change_repo = change_repo or ChangeRepository(db)
        self.detector = detector or ChangeDetector()

    async def process_change(self, change: NormalizedChange) -> ProcessResult:
        # 1. Idempotency table insertion check
        inserted = await self.idempotency_repo.insert_event_if_absent(change)
        if not inserted:
            return ProcessResult(
                status="DUPLICATE_EVENT",
                product_id=change.product_id,
                idempotency_key=change.idempotency_key,
                payload_hash=change.payload_hash,
                message="Duplicate event detected and safely skipped",
            )

        # 2. Acquire per-product lock to serialize concurrent updates
        lock = await self.db.get_product_lock(change.product_id)
        if lock is not None:
            async with lock:
                return await self._process_change_under_lock(change)
        else:
            return await self._process_change_under_lock(change)

    async def _process_change_under_lock(self, change: NormalizedChange) -> ProcessResult:
        # 3. Query latest product record
        latest = await self.change_repo.get_latest_product_change(change.product_id)

        # 4. Detect change vs latest
        decision = self.detector.evaluate(latest, change)

        if decision.status == "STALE":
            await self.idempotency_repo.mark_event_processed(change.idempotency_key, "STALE")
            return ProcessResult(
                status="STALE",
                product_id=change.product_id,
                idempotency_key=change.idempotency_key,
                payload_hash=change.payload_hash,
                message="Stale data: incoming version is older than latest recorded",
            )

        if decision.status == "NO_CHANGE":
            await self.idempotency_repo.mark_event_processed(change.idempotency_key, "NO_CHANGE")
            return ProcessResult(
                status="NO_CHANGE",
                product_id=change.product_id,
                idempotency_key=change.idempotency_key,
                payload_hash=change.payload_hash,
                message="No change detected in payload",
            )

        # 5. Insert new product change record (unique constraint is safety net)
        inserted = await self.change_repo.insert_product_change(change)
        if not inserted:
            await self.idempotency_repo.mark_event_processed(change.idempotency_key, "NO_CHANGE")
            return ProcessResult(
                status="NO_CHANGE",
                product_id=change.product_id,
                idempotency_key=change.idempotency_key,
                payload_hash=change.payload_hash,
                message="Product state already exists in database",
            )

        # 6. Mark event as INSERTED
        await self.idempotency_repo.mark_event_processed(change.idempotency_key, "INSERTED")
        return ProcessResult(
            status="INSERTED",
            product_id=change.product_id,
            idempotency_key=change.idempotency_key,
            payload_hash=change.payload_hash,
            message="New product change recorded successfully",
        )
