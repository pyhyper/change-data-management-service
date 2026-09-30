import hashlib
import json
from datetime import datetime
from typing import Any
from ..domain.exceptions import BadRequestException

def sort_keys_recursively(obj: Any) -> Any:
    if obj is None or not isinstance(obj, (dict, list)):
        return obj
    if isinstance(obj, list):
        return [sort_keys_recursively(item) for item in obj]
    return {k: sort_keys_recursively(obj[k]) for k in sorted(obj.keys()) if obj[k] is not None}

def canonical_json(value: Any) -> str:
    sorted_obj = sort_keys_recursively(value)
    return json.dumps(sorted_obj, separators=(",", ":"), ensure_ascii=False)

def compute_payload_hash(payload: Any) -> str:
    canonical_str = canonical_json(payload)
    return hashlib.sha256(canonical_str.encode("utf-8")).hexdigest()

def normalize_iso_date(date_val: Any) -> str:
    if isinstance(date_val, datetime):
        return date_val.isoformat()
    if isinstance(date_val, (int, float)):
        # Excel timestamp fallback
        from datetime import timezone
        dt = datetime.fromtimestamp((date_val - 25569) * 86400, tz=timezone.utc)
        return dt.isoformat()
    
    val_str = str(date_val).strip()
    try:
        # Standard ISO or common format parsing
        dt = datetime.fromisoformat(val_str.replace("Z", "+00:00"))
        return dt.isoformat()
    except Exception:
        pass
    
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(val_str, fmt).isoformat()
        except ValueError:
            continue
    raise BadRequestException(f"Invalid date format: {date_val}")

def normalize_product(raw: dict[str, Any]) -> dict[str, Any]:
    raw_id = raw.get("id")
    if raw_id is None or str(raw_id).strip() == "":
        raise BadRequestException("Field 'id' is required and cannot be empty")
    
    updated_at_raw = raw.get("updatedAt") or raw.get("updated_at")
    if not updated_at_raw:
        raise BadRequestException("Field 'updatedAt' is required")
    
    normalized: dict[str, Any] = {
        "id": str(raw_id).strip(),
        "updatedAt": normalize_iso_date(updated_at_raw),
    }

    if "sku" in raw and raw["sku"] is not None and str(raw["sku"]).strip() != "":
        normalized["sku"] = str(raw["sku"]).strip()
    
    if "name" in raw and raw["name"] is not None and str(raw["name"]).strip() != "":
        normalized["name"] = str(raw["name"]).strip()
    
    if "quantity" in raw and raw["quantity"] is not None and str(raw["quantity"]).strip() != "":
        try:
            normalized["quantity"] = int(raw["quantity"])
        except ValueError:
            raise BadRequestException("Field 'quantity' must be a valid integer")
    
    if "price" in raw and raw["price"] is not None and str(raw["price"]).strip() != "":
        try:
            normalized["price"] = float(raw["price"])
        except ValueError:
            raise BadRequestException("Field 'price' must be a valid number")
    
    return normalized
