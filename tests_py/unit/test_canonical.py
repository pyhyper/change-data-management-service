from src.cdms.processing.canonical import (
    canonical_json,
    compute_payload_hash,
    normalize_product,
    sort_keys_recursively,
)
from src.cdms.processing.idempotency import (
    derive_excel_idempotency_key,
    derive_polling_idempotency_key,
    derive_webhook_idempotency_key,
)

def test_sort_keys_recursively():
    obj_a = {"z": 1, "a": {"y": 2, "b": 3}}
    obj_b = {"a": {"b": 3, "y": 2}, "z": 1}

    assert sort_keys_recursively(obj_a) == {"a": {"b": 3, "y": 2}, "z": 1}
    assert canonical_json(obj_a) == canonical_json(obj_b)
    assert compute_payload_hash(obj_a) == compute_payload_hash(obj_b)

def test_normalize_product():
    raw = {
        "id": "  PROD-100  ",
        "sku": "  SKU-ABC  ",
        "name": "  Laptop Stand  ",
        "quantity": "15",
        "price": "250000",
        "updatedAt": "2026-09-30 08:30:00",
    }
    normalized = normalize_product(raw)
    assert normalized["id"] == "PROD-100"
    assert normalized["sku"] == "SKU-ABC"
    assert normalized["name"] == "Laptop Stand"
    assert normalized["quantity"] == 15
    assert normalized["price"] == 250000.0

def test_idempotency_keys():
    h = "abc123hash"
    date_str = "2026-09-30T00:00:00"
    assert derive_webhook_idempotency_key("P-1", date_str, h, "custom-evt") == "custom-evt"
    assert derive_webhook_idempotency_key("P-1", date_str, h) == f"WEBHOOK:P-1:{date_str}:{h}"
    assert derive_polling_idempotency_key("P-1", date_str, h) == f"POLL:P-1:{date_str}:{h}"
    assert derive_excel_idempotency_key("file1", 3, "P-1", h) == f"EXCEL:file1:3:P-1:{h}"
