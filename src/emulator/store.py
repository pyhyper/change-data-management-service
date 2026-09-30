from datetime import datetime
from typing import Any

class ProductStore:
    def __init__(self):
        self.products: dict[str, dict[str, Any]] = {}
        self.simulate_failure: bool = False
        self.simulate_delay_ms: int = 0

    def set_simulate_failure(self, val: bool) -> None:
        self.simulate_failure = val

    def set_simulate_delay(self, ms: int) -> None:
        self.simulate_delay_ms = ms

    def should_fail(self) -> bool:
        return self.simulate_failure

    def get_delay(self) -> int:
        return self.simulate_delay_ms

    def clear(self) -> None:
        self.products.clear()

    def add(self, product: dict[str, Any]) -> None:
        self.products[product["id"]] = dict(product)

    def update(self, product_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        if product_id not in self.products:
            return None
        existing = self.products[product_id]
        existing.update(updates)
        if "updatedAt" not in updates:
            from datetime import timezone
            existing["updatedAt"] = datetime.now(timezone.utc).isoformat()
        return existing

    def get_by_id(self, product_id: str) -> dict[str, Any] | None:
        return self.products.get(product_id)

    def list(
        self,
        updated_since: datetime | None = None,
        limit: int = 100,
        offset: int = 0
    ) -> list[dict[str, Any]]:
        all_prods = list(self.products.values())
        if updated_since:
            filtered = []
            for p in all_prods:
                dt = datetime.fromisoformat(p["updatedAt"].replace("Z", "+00:00"))
                if dt > updated_since:
                    filtered.append(p)
            all_prods = filtered

        all_prods.sort(key=lambda x: datetime.fromisoformat(x["updatedAt"].replace("Z", "+00:00")))
        return all_prods[offset:offset + limit]

    def count(self) -> int:
        return len(self.products)

product_store = ProductStore()
