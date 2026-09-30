import asyncio
import os
from datetime import datetime, timezone
from typing import Any
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
import uvicorn
from .seed import seed_products
from .store import ProductStore, product_store

def create_emulator_app(custom_store: ProductStore | None = None) -> FastAPI:
    store = custom_store or product_store
    seed_products(store, 50)

    app = FastAPI(title="Vietful Inventory Service Emulator")
    app.state.store = store

    @app.middleware("http")
    async def failure_simulation_middleware(request: Request, call_next):
        if store.get_delay() > 0:
            await asyncio.sleep(store.get_delay() / 1000.0)

        if store.should_fail() and "/simulate" not in request.url.path:
            return JSONResponse(
                status_code=503,
                content={
                    "error": "SIMULATED_SERVICE_UNAVAILABLE",
                    "message": "Inventory service simulated downtime failure",
                },
            )

        return await call_next(request)

    @app.get("/api/v1/products")
    async def list_products(
        updatedSince: str | None = Query(None),
        limit: int = Query(50),
        offset: int = Query(0)
    ):
        since_dt = None
        if updatedSince:
            try:
                since_dt = datetime.fromisoformat(updatedSince.replace("Z", "+00:00"))
            except ValueError:
                pass

        prods = store.list(updated_since=since_dt, limit=limit, offset=offset)
        return {
            "total": len(prods),
            "storeSize": store.count(),
            "products": prods,
        }

    @app.get("/api/v1/products/{product_id}")
    async def get_product(product_id: str):
        prod = store.get_by_id(product_id)
        if not prod:
            raise HTTPException(status_code=404, detail="Product not found")
        return prod

    @app.post("/api/v1/products")
    async def create_product(payload: dict[str, Any]):
        if "id" not in payload:
            raise HTTPException(status_code=400, detail="Product id is required")
        now_iso = datetime.now(timezone.utc).isoformat()
        prod = {
            "id": str(payload["id"]).strip(),
            "sku": payload.get("sku", f"SKU-{payload['id']}"),
            "name": payload.get("name", f"Product {payload['id']}"),
            "quantity": int(payload.get("quantity", 0)),
            "price": float(payload.get("price", 0.0)),
            "updatedAt": payload.get("updatedAt", now_iso),
        }
        store.add(prod)
        return JSONResponse(status_code=201, content=prod)

    @app.patch("/api/v1/products/{product_id}")
    async def update_product(product_id: str, updates: dict[str, Any]):
        updated = store.update(product_id, updates)
        if not updated:
            raise HTTPException(status_code=404, detail="Product not found")
        return updated

    @app.post("/api/v1/seed")
    async def seed(payload: dict[str, Any] | None = None):
        count = payload.get("count", 50) if payload else 50
        seeded = seed_products(store, count)
        return {
            "message": f"Successfully seeded {len(seeded)} products",
            "count": len(seeded),
        }

    @app.post("/api/v1/simulate/error")
    async def simulate_error(payload: dict[str, Any]):
        if "fail" in payload:
            store.set_simulate_failure(bool(payload["fail"]))
        if "delayMs" in payload:
            store.set_simulate_delay(int(payload["delayMs"]))
        return {
            "simulatedFailure": store.should_fail(),
            "simulatedDelayMs": store.get_delay(),
        }

    @app.get("/health")
    async def health():
        return {
            "status": "UP",
            "service": "inventory-emulator",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    return app

app = create_emulator_app()

if __name__ == "__main__":
    port = int(os.getenv("INVENTORY_PORT", "3001"))
    uvicorn.run("src.emulator.main:app", host="0.0.0.0", port=port, reload=False)
