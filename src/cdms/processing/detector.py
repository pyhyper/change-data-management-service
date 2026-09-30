from dataclasses import dataclass
from ..domain.models import NormalizedChange, ProductChangeRecord

@dataclass(frozen=True)
class DetectionResult:
    status: str
    has_changed: bool
    reason: str | None = None

class ChangeDetector:
    def evaluate(
        self,
        latest: ProductChangeRecord | None,
        incoming: NormalizedChange
    ) -> DetectionResult:
        if latest is None:
            return DetectionResult(status="INSERTED", has_changed=True)

        if incoming.source_updated_at < latest.source_updated_at:
            return DetectionResult(status="STALE", has_changed=False, reason="SOURCE_TIME_OLDER")

        if incoming.payload_hash == latest.payload_hash:
            return DetectionResult(status="NO_CHANGE", has_changed=False, reason="SAME_PAYLOAD_HASH")

        return DetectionResult(status="INSERTED", has_changed=True)
