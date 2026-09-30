import time
from datetime import datetime, timezone
import random
from faker import Faker
from .store import ProductStore

fake = Faker()

def seed_products(store: ProductStore, count: int = 50) -> list[dict]:
    store.clear()
    seeded = []
    now = time.time()

    for i in range(1, count + 1):
        padded_id = f"PROD-{str(i).zfill(3)}"
        # Spread timestamp over recent minutes
        ts = now - (count - i) * 60
        updated_at = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

        prod = {
            "id": padded_id,
            "sku": f"SKU-{fake.bothify(text='????##').upper()}",
            "name": fake.commerce.product_name() if hasattr(fake, "commerce") else f"Product {padded_id}",
            "quantity": random.randint(5, 200),
            "price": float(random.randint(50, 1500) * 1000),
            "updatedAt": updated_at,
        }
        store.add(prod)
        seeded.append(prod)

    return seeded
