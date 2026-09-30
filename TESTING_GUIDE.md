# Cẩm nang Kiểm thử và Trình diễn Hệ thống (CDMS Testing & Demo Guide)

> Tài liệu hướng dẫn chi tiết quy trình thực thi kiểm thử tự động, xác minh các kịch bản Exactly-Once Update, khả năng phục hồi lỗi và hướng dẫn trình diễn nguyên mẫu (working prototype) trước hội đồng đánh giá kỹ thuật.

---

## 1. Giới thiệu tổng quan

Hệ thống Change Data Management Service (CDMS) được trang bị bộ kịch bản kiểm thử toàn diện, bao gồm:
1. **Kiểm thử tự động tầng ứng dụng (Pytest):** 9 bài test tích hợp, tương tranh và phục hồi lỗi chạy độc lập trong 0.30 giây.
2. **Kịch bản chạy thử nghiệm đầu cuối (End-to-End Demo Script):** Tự động gửi request thật đến HTTP API đang chạy (PostgreSQL hoặc In-memory), kiểm tra từng phản hồi theo từng bước và in kết quả trực quan trên terminal.
3. **Kịch bản kiểm thử tải đột biến (Spike Load Testing):** Mô phỏng 50 Virtual Users gửi request đồng thời qua k6.

---

## 2. Cách thực thi nhanh bằng 1 lệnh (Quick Run)

Để kiểm chứng toàn bộ hệ thống từ A đến Z, chỉ cần thực thi script tự động hóa được tích hợp sẵn:

```bash
./scripts/run_demo.sh
```

Hoặc gọi trực tiếp qua Python trong môi trường ảo:

```bash
source .venv/bin/activate
python3 scripts/demo_test.py
```

---

## 3. Chi tiết 9 Kịch bản trong Script Kiểm thử

Kịch bản `scripts/demo_test.py` tự động kích hoạt và xác nhận tính đúng đắn của 9 bước nghiệp vụ sau:

### Kịch bản 1: Kiểm tra Liveness & Readiness của dịch vụ
- **Mục tiêu:** Xác nhận tiến trình API đang hoạt động và cơ sở dữ liệu đã kết nối thành công.
- **Endpoints:**
  - `GET http://localhost:3000/health` -> Phản hồi HTTP 200 `{"status": "UP"}`.
  - `GET http://localhost:3000/ready` -> Phản hồi HTTP 200 `{"status": "READY", "db": "CONNECTED"}`.

### Kịch bản 2: Webhook lần 1 — Tiếp nhận dữ liệu mới (INSERTED)
- **Mục tiêu:** Nhận một bản ghi sản phẩm mới qua Webhook kèm khóa `Idempotency-Key: evt-<PROD_ID>-01`.
- **Dữ liệu gửi:**
  ```json
  {
    "id": "DEMO-001",
    "name": "Thiet bi Cam bien IoT",
    "quantity": 100,
    "price": 350000.0,
    "updatedAt": "2026-09-30T10:00:00Z"
  }
  ```
- **Kết quả mong đợi:** HTTP 200, `status: "INSERTED"`.

### Kịch bản 3: Webhook lần 2 — Gửi lại cùng Idempotency-Key (DUPLICATE_EVENT)
- **Mục tiêu:** Mô phỏng tình huống client bị timeout mạng và retry lại cùng một request.
- **Dữ liệu gửi:** Giống hệt Kịch bản 2, giữ nguyên `Idempotency-Key: evt-<PROD_ID>-01`.
- **Kết quả mong đợi:** HTTP 200, `status: "DUPLICATE_EVENT"`, `message: "Duplicate event detected and safely skipped"`. Cơ sở dữ liệu không bị ghi trùng bản ghi.

### Kịch bản 4: Webhook lần 3 — Dữ liệu không đổi với khóa mới (NO_CHANGE)
- **Mục tiêu:** Một nguồn dữ liệu khác gửi thông tin sản phẩm nhưng các trường giá, số lượng, tên vẫn y nguyên.
- **Dữ liệu gửi:** Payload giống Kịch bản 2 nhưng dùng `Idempotency-Key: evt-<PROD_ID>-02`.
- **Kết quả mong đợi:** HTTP 200, `status: "NO_CHANGE"`, `message: "No change detected in payload"`.

### Kịch bản 5: Webhook lần 4 — Dữ liệu cũ đến muộn (STALE)
- **Mục tiêu:** Một sự kiện phát sinh trong quá khứ bị tắc nghẽn mạng và đến sau dữ liệu hiện tại.
- **Dữ liệu gửi:** Mốc `updatedAt: "2026-09-20T08:00:00Z"` (cũ hơn mốc `2026-09-30`).
- **Kết quả mong đợi:** HTTP 200, `status: "STALE"`, `message: "Stale data: incoming version is older than latest recorded"`. Dữ liệu mới trong database được bảo vệ, không bị ghi đè.

### Kịch bản 6: Upload file Excel lần 1 — Phân loại từng dòng dữ liệu
- **Mục tiêu:** Tiếp nhận tệp bảng tính `sample_inventory.xlsx` qua giao diện multipart HTTP POST.
- **Cấu trúc tệp:**
  - Dòng 1: Sản phẩm mới -> Phân loại `inserted`.
  - Dòng 2: Sản phẩm có nội dung trùng với bản ghi trong database -> Phân loại `noChange`.
  - Dòng 3: Sản phẩm có mốc thời gian cũ hơn -> Phân loại `stale`.
- **Kết quả mong đợi:** HTTP 200, trả về thống kê chi tiết:
  ```json
  {
    "file": "sample_inventory.xlsx",
    "rows": 3,
    "inserted": 2,
    "noChange": 0,
    "stale": 1,
    "duplicate": 0,
    "invalid": 0,
    "errors": []
  }
  ```

### Kịch bản 7: Upload lại cùng file Excel lần 2 — Lọc trùng lặp cấp độ file (DUPLICATE)
- **Mục tiêu:** Nhân viên vô tình nhấn upload lại cùng một tệp bảng tính.
- **Cơ chế:** Khóa idempotency của từng dòng được suy dẫn từ `SHA-256(file_bytes) + row_index`.
- **Kết quả mong đợi:** HTTP 200, `duplicate: 3`, `inserted: 0`.

### Kịch bản 8: Truy vấn Lịch sử Thay đổi Sản phẩm (Audit Log)
- **Mục tiêu:** Xác minh chỉ có đúng những bản ghi thực sự thay đổi được lưu trữ trong bảng `product_changes`.
- **Endpoint:** `GET http://localhost:3000/api/v1/products/<PROD_ID>/history`.
- **Kết quả mong đợi:** HTTP 200, `totalChanges: 1`, mỗi bản ghi chứa đầy đủ `payload_hash` (SHA-256 tất định) và mốc thời gian.

### Kịch bản 9: Chạy toàn bộ Bộ kiểm thử tự động (Pytest Suite)
- **Mục tiêu:** Xác minh 100% các bài test đơn vị, tích hợp, tương tranh (CT-01 đến CT-04) và phục hồi lỗi (FT-01, FT-02) vượt qua kiểm tra.
- **Lệnh thực thi ngầm:** `pytest -v`.
- **Kết quả mong đợi:** `9 passed in 0.30s`.

---

## 4. Hướng dẫn chạy thử nghiệm thủ công với Curl

Nếu muốn tự tay thực thi từng lệnh `curl` độc lập trên terminal:

### 1. Gọi Webhook tạo mới:
```bash
curl -i -X POST http://localhost:3000/api/v1/webhooks/products \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: manual-evt-01" \
  -d '{
    "id": "PROD-MANUAL-01",
    "name": "Ban phim Co Custom",
    "quantity": 20,
    "price": 2500000,
    "updatedAt": "2026-09-30T10:00:00Z"
  }'
```

### 2. Gửi lại request trên để kiểm tra Idempotency:
```bash
curl -i -X POST http://localhost:3000/api/v1/webhooks/products \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: manual-evt-01" \
  -d '{
    "id": "PROD-MANUAL-01",
    "name": "Ban phim Co Custom",
    "quantity": 20,
    "price": 2500000,
    "updatedAt": "2026-09-30T10:00:00Z"
  }'
```

### 3. Upload file Excel:
```bash
curl -X POST http://localhost:3000/api/v1/imports/products/excel \
  -F "file=@sample_inventory.xlsx"
```

### 4. Kiểm tra lịch sử thay đổi:
```bash
curl -s http://localhost:3000/api/v1/products/PROD-MANUAL-01/history
```

---

## 5. Bảng tổng hợp đối chiếu với yêu cầu đề bài

| Tiêu chí đề bài | Kịch bản kiểm chứng | Trạng thái |
|---|---|---|
| Chạy trên máy đơn (Single machine) | Hệ thống chạy trọn vẹn trên local/container | Đạt 100% |
| Exactly-Once Update (Không lưu dữ liệu cũ, không trùng) | Kịch bản 2, 3, 4, 5, 7 | Đạt 100% |
| Chống chịu lỗi và phục hồi sau sự cố | Kịch bản 9 (`tests/failure/test_failure.py`) | Đạt 100% |
| Môi trường container hóa (Docker) | Kịch bản 1 qua Docker Compose (`docker compose ps`) | Đạt 100% |
| Xử lý tương tranh (Concurrency) | Kịch bản 9 (`tests/concurrency/test_concurrency.py`) | Đạt 100% |
