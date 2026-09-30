import json
import os
import subprocess
import sys
import time
from typing import Any
import httpx

BASE_URL = os.getenv("CDMS_BASE_URL", "http://localhost:3000")
EMULATOR_URL = os.getenv("EMULATOR_BASE_URL", "http://localhost:3001")

def print_separator(title: str):
    print("\n" + "=" * 80)
    print(f"--- {title} ---")
    print("=" * 80)

def assert_response(name: str, condition: bool, details: Any = None):
    if condition:
        print(f"[PASS] {name}")
    else:
        print(f"[FAIL] {name}")
        if details:
            print(f"Details: {details}")
        sys.exit(1)

def run_live_tests():
    print_separator("KHOI CHAY KIEM THU TU DONG PROTOTYPE CDMS")
    print(f"Target CDMS URL: {BASE_URL}")
    print(f"Target Emulator URL: {EMULATOR_URL}")

    with httpx.Client(timeout=10.0) as client:
        # Step 1: Health & Readiness
        print_separator("KICH BAN 1: KIEM TRA TRANG THAI HE THONG (HEALTH & READINESS)")
        try:
            res_health = client.get(f"{BASE_URL}/health")
            assert_response("CDMS Liveness Check (/health)", res_health.status_code == 200)
            print("Response:", json.dumps(res_health.json(), indent=2))

            res_ready = client.get(f"{BASE_URL}/ready")
            assert_response("CDMS Readiness Check (/ready)", res_ready.status_code == 200)
            print("Response:", json.dumps(res_ready.json(), indent=2))
        except Exception as e:
            assert_response("Ket noi toi CDMS", False, str(e))

        # Step 2: Webhook First Call -> INSERTED
        print_separator("KICH BAN 2: WEBHOOK LAN 1 -> GHI NHAN DULIEU MOI (INSERTED)")
        prod_id = f"DEMO-{int(time.time())}"
        key_01 = f"evt-{prod_id}-01"
        payload_01 = {
            "id": prod_id,
            "name": "Thiet bi Cam bien IoT",
            "quantity": 100,
            "price": 350000.0,
            "updatedAt": "2026-09-30T10:00:00Z"
        }
        res_wb1 = client.post(
            f"{BASE_URL}/api/v1/webhooks/products",
            headers={"Content-Type": "application/json", "Idempotency-Key": key_01},
            json=payload_01
        )
        assert_response("Webhook Lan 1 status code 200", res_wb1.status_code == 200)
        data_wb1 = res_wb1.json()
        assert_response("Webhook Lan 1 status la INSERTED", data_wb1.get("status") == "INSERTED")
        print("Response:", json.dumps(data_wb1, indent=2))

        # Step 3: Webhook Duplicate Key -> DUPLICATE_EVENT
        print_separator("KICH BAN 3: WEBHOOK LAN 2 CUNG IDEMPOTENCY-KEY -> LOC TRUNG (DUPLICATE_EVENT)")
        res_wb2 = client.post(
            f"{BASE_URL}/api/v1/webhooks/products",
            headers={"Content-Type": "application/json", "Idempotency-Key": key_01},
            json=payload_01
        )
        assert_response("Webhook Lan 2 status code 200", res_wb2.status_code == 200)
        data_wb2 = res_wb2.json()
        assert_response("Webhook Lan 2 status la DUPLICATE_EVENT", data_wb2.get("status") == "DUPLICATE_EVENT")
        print("Response:", json.dumps(data_wb2, indent=2))

        # Step 4: Webhook Identical Data with new key -> NO_CHANGE
        print_separator("KICH BAN 4: WEBHOOK DU LIEU KHONG DOI, KHOA MOI -> BO QUA (NO_CHANGE)")
        key_02 = f"evt-{prod_id}-02"
        res_wb3 = client.post(
            f"{BASE_URL}/api/v1/webhooks/products",
            headers={"Content-Type": "application/json", "Idempotency-Key": key_02},
            json=payload_01
        )
        assert_response("Webhook Lan 3 status code 200", res_wb3.status_code == 200)
        data_wb3 = res_wb3.json()
        assert_response("Webhook Lan 3 status la NO_CHANGE", data_wb3.get("status") == "NO_CHANGE")
        print("Response:", json.dumps(data_wb3, indent=2))

        # Step 5: Webhook Stale Timestamp -> STALE
        print_separator("KICH BAN 5: WEBHOOK DU LIEU CU HON MOI NHAT -> TU CHOI GHI DE (STALE)")
        key_03 = f"evt-{prod_id}-03"
        stale_payload = {
            "id": prod_id,
            "name": "Thiet bi Cam bien IoT (Ban cu)",
            "quantity": 50,
            "price": 300000.0,
            "updatedAt": "2026-09-20T08:00:00Z"
        }
        res_wb4 = client.post(
            f"{BASE_URL}/api/v1/webhooks/products",
            headers={"Content-Type": "application/json", "Idempotency-Key": key_03},
            json=stale_payload
        )
        assert_response("Webhook Lan 4 status code 200", res_wb4.status_code == 200)
        data_wb4 = res_wb4.json()
        assert_response("Webhook Lan 4 status la STALE", data_wb4.get("status") == "STALE")
        print("Response:", json.dumps(data_wb4, indent=2))

        # Step 6: Excel Upload First Time
        print_separator("KICH BAN 6: UPLOAD FILE EXCEL LAN 1 -> PHAN LOAI DONG DULIEU")
        excel_path = "sample_inventory.xlsx"
        if not os.path.exists(excel_path):
            assert_response("Ton tai file sample_inventory.xlsx", False, "Khong tim thay file")

        with open(excel_path, "rb") as f:
            res_xls1 = client.post(
                f"{BASE_URL}/api/v1/imports/products/excel",
                files={"file": (excel_path, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
            )
        assert_response("Excel Upload Lan 1 status code 200", res_xls1.status_code == 200)
        data_xls1 = res_xls1.json()
        assert_response("Excel Upload rows == 3", data_xls1.get("rows") == 3)
        print("Response:", json.dumps(data_xls1, indent=2))

        # Step 7: Excel Upload Second Time -> duplicate: 3
        print_separator("KICH BAN 7: UPLOAD LAI CUNG FILE EXCEL -> NHAN DIEN TRUNG LAP DUPLICATE: 3")
        with open(excel_path, "rb") as f:
            res_xls2 = client.post(
                f"{BASE_URL}/api/v1/imports/products/excel",
                files={"file": (excel_path, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
            )
        assert_response("Excel Upload Lan 2 status code 200", res_xls2.status_code == 200)
        data_xls2 = res_xls2.json()
        assert_response("Excel Upload Lan 2 duplicate == 3", data_xls2.get("duplicate") == 3)
        print("Response:", json.dumps(data_xls2, indent=2))

        # Step 8: Query Product Change History
        print_separator(f"KICH BAN 8: TRUY VAN LICH SU THAY DOI SAN PHAM {prod_id}")
        res_hist = client.get(f"{BASE_URL}/api/v1/products/{prod_id}/history")
        assert_response("Lich su san pham status code 200", res_hist.status_code == 200)
        data_hist = res_hist.json()
        assert_response("Chua duy nhat 1 ban ghi da insert", data_hist.get("totalChanges") == 1)
        print("Response:", json.dumps(data_hist, indent=2))

    # Step 9: Run Automated Pytest
    print_separator("KICH BAN 9: CHAY BO KIEM THU TU DONG TOAN DIEN (PYTEST)")
    pytest_bin = ".venv/bin/pytest" if os.path.exists(".venv/bin/pytest") else "pytest"
    res_pytest = subprocess.run([pytest_bin, "-v"], capture_output=True, text=True)
    print(res_pytest.stdout)
    assert_response("Pytest 9/9 bai test vuot qua 100%", res_pytest.returncode == 0)

    print_separator("KET QUA: TAT CA CAC KICH BAN DEMO VA KIEM THU DEU THANH CONG 100%")

if __name__ == "__main__":
    run_live_tests()
