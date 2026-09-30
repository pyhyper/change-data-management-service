from ..domain.models import NormalizedChange, ProductChangeRecord

class ChangeRepository:
    def __init__(self, db):
        self.db = db

    async def get_latest_product_change(self, product_id: str) -> ProductChangeRecord | None:
        data = await self.db.get_latest_product_change(product_id)
        if not data:
            return None
        return ProductChangeRecord(
            id=data["id"],
            product_id=data["product_id"],
            source=data["source"],
            source_updated_at=data["source_updated_at"],
            payload=data["payload"],
            payload_hash=data["payload_hash"],
            created_at=data["created_at"],
        )

    async def insert_product_change(self, change: NormalizedChange) -> bool:
        return await self.db.insert_product_change(
            product_id=change.product_id,
            source=change.source,
            source_updated_at=change.source_updated_at,
            payload=change.payload,
            payload_hash=change.payload_hash,
        )

    async def list_product_changes(self, product_id: str | None = None) -> list[ProductChangeRecord]:
        raw_list = await self.db.list_product_changes(product_id)
        return [
            ProductChangeRecord(
                id=d["id"],
                product_id=d["product_id"],
                source=d["source"],
                source_updated_at=d["source_updated_at"],
                payload=d["payload"],
                payload_hash=d["payload_hash"],
                created_at=d["created_at"],
            )
            for d in raw_list
        ]
