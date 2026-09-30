import uuid
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, File, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from ..domain.exceptions import AppException
from ..domain.models import NormalizedChange
from ..ingestion.excel import process_excel_upload
from ..processing.canonical import compute_payload_hash, normalize_product
from ..processing.idempotency import derive_webhook_idempotency_key

def create_api_router(change_processor, change_repo, db) -> APIRouter:
    router = APIRouter()

    @router.post("/api/v1/webhooks/products")
    async def webhook_products(
        payload: dict[str, Any],
        idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
        x_request_id: str | None = Header(None, alias="X-Request-Id")
    ):
        req_id = x_request_id or f"req-{uuid.uuid4().hex[:8]}"
        normalized = normalize_product(payload)
        payload_hash = compute_payload_hash(normalized)
        key = derive_webhook_idempotency_key(
            normalized["id"],
            normalized["updatedAt"],
            payload_hash,
            idempotency_key
        )

        dt = datetime.fromisoformat(normalized["updatedAt"].replace("Z", "+00:00"))
        change = NormalizedChange(
            product_id=normalized["id"],
            source="WEBHOOK",
            source_updated_at=dt,
            payload=normalized,
            payload_hash=payload_hash,
            idempotency_key=key,
        )

        res = await change_processor.process_change(change)
        return {
            "requestId": req_id,
            "status": res.status,
            "productId": res.product_id,
            "idempotencyKey": res.idempotency_key,
            "message": res.message,
        }

    @router.post("/api/v1/imports/products/excel")
    async def import_excel(file: UploadFile = File(...)):
        if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
            raise HTTPException(status_code=400, detail="Only .xlsx Excel files are supported")
        contents = await file.read()
        summary = await process_excel_upload(contents, file.filename, change_processor)
        return summary

    @router.get("/api/v1/changes")
    async def get_changes(productId: str | None = Query(None)):
        records = await change_repo.list_product_changes(productId)
        return {
            "total": len(records),
            "changes": [r.model_dump(by_alias=True) for r in records],
        }

    @router.get("/api/v1/products/{product_id}/history")
    async def get_product_history(product_id: str):
        records = await change_repo.list_product_changes(product_id)
        return {
            "productId": product_id,
            "totalChanges": len(records),
            "changes": [r.model_dump(by_alias=True) for r in records],
        }

    @router.get("/health")
    async def health():
        return {
            "status": "UP",
            "service": "cdms-api",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    @router.get("/ready")
    async def ready():
        healthy = await db.is_healthy()
        if not healthy:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "NOT_READY",
                    "db": "DISCONNECTED",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )
        return {
            "status": "READY",
            "db": "CONNECTED",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    return router
