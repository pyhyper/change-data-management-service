from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field

IngestionSource = Literal["POLL", "WEBHOOK", "EXCEL"]
ProcessStatus = Literal["INSERTED", "DUPLICATE_EVENT", "NO_CHANGE", "STALE"]

class ProductPayload(BaseModel):
    id: str = Field(..., min_length=1)
    sku: str | None = None
    name: str | None = None
    quantity: int | None = None
    price: float | None = None
    updatedAt: str

class NormalizedChange(BaseModel):
    product_id: str
    source: IngestionSource
    source_updated_at: datetime
    payload: dict[str, Any]
    payload_hash: str
    idempotency_key: str

class ProcessResult(BaseModel):
    status: ProcessStatus
    product_id: str
    idempotency_key: str
    payload_hash: str
    message: str | None = None

class ProductChangeRecord(BaseModel):
    id: int
    product_id: str
    source: IngestionSource
    source_updated_at: datetime
    payload: dict[str, Any]
    payload_hash: str
    created_at: datetime

class IngestionEventRecord(BaseModel):
    id: int
    idempotency_key: str
    source: IngestionSource
    payload_hash: str
    status: str
    created_at: datetime
    processed_at: datetime | None = None
    error_message: str | None = None

class PollingCheckpointRecord(BaseModel):
    source: str
    last_updated_at: datetime | None = None
    cursor: str | None = None
    updated_at: datetime
