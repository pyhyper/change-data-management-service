import hashlib

def derive_webhook_idempotency_key(
    product_id: str,
    updated_at: str,
    payload_hash: str,
    client_key: str | None = None
) -> str:
    if client_key and client_key.strip():
        return client_key.strip()
    return f"WEBHOOK:{product_id}:{updated_at}:{payload_hash}"

def derive_polling_idempotency_key(
    product_id: str,
    updated_at: str,
    payload_hash: str
) -> str:
    return f"POLL:{product_id}:{updated_at}:{payload_hash}"

def derive_excel_idempotency_key(
    file_hash: str,
    row_number: int,
    product_id: str,
    payload_hash: str
) -> str:
    return f"EXCEL:{file_hash}:{row_number}:{product_id}:{payload_hash}"

def compute_buffer_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]
