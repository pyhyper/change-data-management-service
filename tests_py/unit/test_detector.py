from datetime import datetime, timezone
from src.cdms.domain.models import NormalizedChange, ProductChangeRecord
from src.cdms.processing.detector import ChangeDetector

def test_change_detector_decisions():
    detector = ChangeDetector()
    t1 = datetime(2026, 9, 30, 10, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 9, 30, 10, 5, tzinfo=timezone.utc)
    t0 = datetime(2026, 9, 30, 9, 50, tzinfo=timezone.utc)

    incoming_new = NormalizedChange(
        product_id="P-1",
        source="WEBHOOK",
        source_updated_at=t1,
        payload={"id": "P-1", "quantity": 10},
        payload_hash="hash-1",
        idempotency_key="k1",
    )

    # 1. No latest record -> INSERTED
    r1 = detector.evaluate(None, incoming_new)
    assert r1.status == "INSERTED"
    assert r1.has_changed is True

    latest = ProductChangeRecord(
        id=1,
        product_id="P-1",
        source="WEBHOOK",
        source_updated_at=t1,
        payload={"id": "P-1", "quantity": 10},
        payload_hash="hash-1",
        created_at=t1,
    )

    # 2. Same hash -> NO_CHANGE
    incoming_same = NormalizedChange(
        product_id="P-1",
        source="WEBHOOK",
        source_updated_at=t2,
        payload={"id": "P-1", "quantity": 10},
        payload_hash="hash-1",
        idempotency_key="k2",
    )
    r2 = detector.evaluate(latest, incoming_same)
    assert r2.status == "NO_CHANGE"
    assert r2.has_changed is False

    # 3. Older timestamp -> STALE
    incoming_stale = NormalizedChange(
        product_id="P-1",
        source="WEBHOOK",
        source_updated_at=t0,
        payload={"id": "P-1", "quantity": 5},
        payload_hash="hash-old",
        idempotency_key="k0",
    )
    r3 = detector.evaluate(latest, incoming_stale)
    assert r3.status == "STALE"
    assert r3.has_changed is False

    # 4. Newer timestamp and different hash -> INSERTED
    incoming_newer = NormalizedChange(
        product_id="P-1",
        source="WEBHOOK",
        source_updated_at=t2,
        payload={"id": "P-1", "quantity": 20},
        payload_hash="hash-2",
        idempotency_key="k3",
    )
    r4 = detector.evaluate(latest, incoming_newer)
    assert r4.status == "INSERTED"
    assert r4.has_changed is True
