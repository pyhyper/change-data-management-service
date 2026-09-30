# README.md — Change Data Management Service (CDMS)

> Hệ thống thu thập, phát hiện và lưu trữ dữ liệu thay đổi (Change Data Management) theo nguyên tắc Exactly-Once Update từ nhiều nguồn dữ liệu không đồng nhất (Webhook, Scheduled Polling, Excel Upload).  
> Dự án được xây dựng dựa trên đặc tả tại `SPEC.md`, kiến trúc tại `ARCHITECTURE.md`, thiết kế chi tiết tại `DESIGN.md`, kế hoạch tại `PLAN.md` và tiêu chuẩn mã nguồn tại `CODING_STANDARDS.md`.

---

## 1. Tổng quan hệ thống

Hệ thống CDMS giải quyết bài toán cốt lõi: Tiếp nhận luồng dữ liệu sản phẩm (Product) từ 3 nguồn độc lập đổ về liên tục, phát hiện và chỉ ghi nhận những thay đổi thực sự vào cơ sở dữ liệu PostgreSQL mà không tạo bản ghi trùng lặp, bảo đảm tính toàn vẹn ngay cả khi xảy ra sự cố mạng, retry liên tục hoặc tải đột biến (spike load).

### Ba nguồn tiếp nhận dữ liệu (Ingestion Sources)
1. **Webhook Callback:** Nhận sự kiện thay đổi sản phẩm qua HTTP REST endpoint dưới dạng JSON payload.
2. **Scheduled Polling:** Quét định kỳ dịch vụ giả lập Vietful Inventory Service theo checkpoint mốc thời gian.
3. **Excel File Upload:** Tiếp nhận tệp bảng tính `.xlsx` qua giao diện multipart HTTP POST, phân tích từng dòng và xử lý theo lô có kiểm soát tương tranh.

### Cơ chế Exactly-Once Update cốt lõi
- **Canonicalization & Deterministic Hash:** Sắp xếp đệ quy toàn bộ các khóa JSON trước khi tính mã băm SHA-256 (`sortKeysRecursively`), bảo đảm dữ liệu có cùng ngữ nghĩa luôn cho ra cùng một mã hash ổn định.
- **Idempotency Layer:** Sử dụng khóa định danh duy nhất (`idempotency_key`) tại bảng `ingestion_events` để lọc bỏ ngay các request retry trùng lặp.
- **Per-Product Advisory Locking:** Đồng bộ hóa tuần tự các thao tác ghi trên cùng một sản phẩm bằng lock cấp độ transaction, ngăn chặn xung đột tương tranh và hiện tượng race condition.
- **State Versioning & Stale Rejection:** So sánh mốc thời gian `sourceUpdatedAt` và mã hash với bản ghi mới nhất của sản phẩm trong bảng `product_changes`. Các bản ghi đến muộn hoặc cũ hơn trạng thái hiện tại sẽ bị đánh dấu là `STALE` và không ghi đè dữ liệu mới.
- **Unique Constraint Safety Net:** Ràng buộc `UNIQUE (product_id, payload_hash)` tại cơ sở dữ liệu làm chốt chặn an toàn cuối cùng chống trùng lặp dữ liệu.

---

## 2. Cấu trúc mã nguồn

Codebase được tổ chức theo kiến trúc phân tầng sạch (Clean / Layered Architecture) chuẩn TypeScript:

```text
cdms-project/
├── apps/
│   ├── cdms/                                # Dịch vụ cốt lõi CDMS
│   │   └── src/
│   │       ├── api/                         # Tầng giao diện HTTP REST
│   │       │   ├── controllers/             # Webhook, Excel, Change controllers
│   │       │   ├── middlewares/             # Request Logger, Error Handler
│   │       │   └── routes/                  # Định tuyến endpoint
│   │       ├── config/                      # Cấu hình biến môi trường qua Zod
│   │       ├── domain/                      # Models, Exception classes, Zod Schemas
│   │       ├── ingestion/                   # Triển khai 3 luồng tiếp nhận
│   │       │   ├── webhook/                 # Webhook handler logic
│   │       │   ├── excel/                   # Parser và validator file .xlsx
│   │       │   └── polling/                 # Inventory client và Polling scheduler
│   │       ├── processing/                  # Pipeline xử lý dữ liệu chung
│   │       │   ├── canonical/               # Chuẩn hóa JSON và tính hash SHA-256
│   │       │   ├── detector/                # Change detector (INSERTED, NO_CHANGE, STALE)
│   │       │   └── pipeline/                # ChangeProcessor điều phối transaction
│   │       ├── repositories/                # Idempotency, Change, Checkpoint repositories
│   │       ├── db/                          # Database connection pool và SQL migrations
│   │       └── app.ts                       # Điểm khởi chạy CDMS Service
│   │
│   └── inventory-emulator/                  # Dịch vụ giả lập Vietful Inventory Service
│       └── src/
│           ├── api/                         # Endpoints truy vấn và mô phỏng lỗi
│           ├── store/                       # Kho lưu trữ in-memory hỗ trợ delay/fail
│           ├── seed/                        # Tự động sinh dữ liệu mẫu với Faker
│           └── app.ts                       # Điểm khởi chạy Inventory Emulator
│
├── tests/                                   # Bộ kiểm thử tự động
│   ├── unit/                                # Kiểm thử độc lập canonicalization & detector
│   ├── integration/                         # Kiểm thử tích hợp Webhook, Excel, Polling
│   ├── concurrency/                         # Kiểm thử tương tranh CT-01 đến CT-04
│   ├── failure/                             # Kiểm thử phục hồi lỗi FT-01, FT-02
│   └── load/                                # Kịch bản kiểm thử tải đột biến với k6
│
├── docker-compose.yml                       # Khởi chạy toàn bộ hệ thống bằng 1 lệnh
├── Dockerfile.cdms                          # Multi-stage Docker build cho CDMS
├── Dockerfile.emulator                      # Multi-stage Docker build cho Emulator
├── SPEC.md                                  # Đặc tả yêu cầu bài test
├── ARCHITECTURE.md                          # Thiết kế kiến trúc tổng thể
├── DESIGN.md                                # Thiết kế kỹ thuật chi tiết
├── PLAN.md                                  # Kế hoạch triển khai theo milestone
├── CODING_STANDARDS.md                      # Tiêu chuẩn và quy tắc viết code
├── vitest.config.ts                         # Cấu hình kiểm thử tự động
└── package.json                             # Cấu hình dự án và dependencies
```

---

## 3. Yêu cầu môi trường

- **Node.js:** Phiên bản `>= 20.x` (đã kiểm tra tương thích trên Node.js v23).
- **npm:** Phiên bản `>= 10.x`.
- **Docker & Docker Compose:** (Tùy chọn, dùng khi muốn chạy toàn bộ trên container hóa).

---

## 4. Hướng dẫn cài đặt và khởi chạy

### Cách 1: Chạy trực tiếp bằng Node.js (Phát triển cục bộ)

1. Cài đặt các gói phụ thuộc:
   ```bash
   npm install
   ```

2. Biên dịch kiểm tra mã nguồn TypeScript:
   ```bash
   npm run build
   ```

3. Khởi động Inventory Emulator (chạy trên cổng `3001`):
   ```bash
   npm run start:emulator
   ```

4. Khởi động CDMS Service (chạy trên cổng `3000` ở cửa sổ terminal khác):
   ```bash
   npm run start:cdms
   ```

> Lưu ý: Mặc định khi không có PostgreSQL daemon đang chạy, hệ thống tự động kích hoạt `MemoryDatabaseClient` mô phỏng đầy đủ hành vi transaction, khóa mutex và ràng buộc khóa duy nhất của PostgreSQL để phục vụ phát triển và kiểm thử mà không cần cài đặt database ngoài.

### Cách 2: Chạy toàn bộ bằng Docker Compose (PostgreSQL + CDMS + Emulator)

Chỉ cần thực thi một lệnh duy nhất tại thư mục gốc:

```bash
docker compose up --build
```

Lệnh trên sẽ tự động:
- Khởi tạo container PostgreSQL 16 và áp dụng file migration `001_initial_schema.sql`.
- Khởi tạo container `inventory-emulator` và tự động seed 50 sản phẩm mẫu.
- Chờ PostgreSQL và Emulator sẵn sàng rồi khởi tạo container `cdms-api`.

---

## 5. Danh mục API Endpoints

### 5.1 CDMS Service (`http://localhost:3000`)

| Phương thức | Đường dẫn | Chức năng | Tham số / Header |
|---|---|---|---|
| `POST` | `/api/v1/webhooks/products` | Tiếp nhận webhook cập nhật sản phẩm | Header `Idempotency-Key` (tùy chọn), JSON Body |
| `POST` | `/api/v1/imports/products/excel` | Upload file Excel chứa danh sách thay đổi | Multipart form `file` (chấp nhận `.xlsx`) |
| `GET` | `/api/v1/changes` | Truy vấn toàn bộ lịch sử thay đổi đã ghi nhận | Query param `productId` (tùy chọn) |
| `GET` | `/api/v1/products/:id/history` | Truy vấn lịch sử thay đổi của 1 sản phẩm | Param `id` của sản phẩm |
| `GET` | `/health` | Kiểm tra trạng thái hoạt động của tiến trình (Liveness) | Không |
| `GET` | `/ready` | Kiểm tra mức độ sẵn sàng kết nối DB (Readiness) | Không |

#### Ví dụ gọi Webhook:
```bash
curl -X POST http://localhost:3000/api/v1/webhooks/products \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: evt-sample-01" \
  -d '{
    "id": "PROD-001",
    "name": "Ban phim co",
    "quantity": 10,
    "price": 1200000,
    "updatedAt": "2026-09-30T10:00:00Z"
  }'
```

Phản hồi:
```json
{
  "requestId": "req-98765432",
  "status": "INSERTED",
  "productId": "PROD-001",
  "idempotencyKey": "evt-sample-01",
  "message": "New product change recorded successfully"
}
```

Nếu gửi lại request trên cùng `Idempotency-Key`:
```json
{
  "requestId": "req-12345678",
  "status": "DUPLICATE_EVENT",
  "productId": "PROD-001",
  "idempotencyKey": "evt-sample-01",
  "message": "Duplicate event detected and safely skipped"
}
```

#### Ví dụ Upload Excel:
```bash
curl -X POST http://localhost:3000/api/v1/imports/products/excel \
  -F "file=@/duong/dan/toi/products.xlsx"
```

Phản hồi thống kê:
```json
{
  "file": "products.xlsx",
  "rows": 50,
  "inserted": 42,
  "noChange": 5,
  "stale": 1,
  "duplicate": 2,
  "invalid": 0,
  "errors": []
}
```

### 5.2 Inventory Emulator (`http://localhost:3001`)

| Phương thức | Đường dẫn | Chức năng |
|---|---|---|
| `GET` | `/api/v1/products` | Lấy danh sách sản phẩm (hỗ trợ `updatedSince`, `limit`, `offset`) |
| `GET` | `/api/v1/products/:id` | Lấy chi tiết sản phẩm theo ID |
| `POST` | `/api/v1/products` | Tạo mới một sản phẩm |
| `PATCH` | `/api/v1/products/:id` | Cập nhật thông tin sản phẩm (tự động cập nhật `updatedAt`) |
| `POST` | `/api/v1/seed` | Sinh lại dữ liệu mẫu với Faker (body: `{"count": 50}`) |
| `POST` | `/api/v1/simulate/error` | Bật/tắt mô phỏng lỗi hoặc độ trễ mạng (`{"fail": true, "delayMs": 500}`) |
| `GET` | `/health` | Kiểm tra sức khỏe của Emulator |

---

## 6. Hướng dẫn chạy Bộ kiểm thử (Automated Tests)

Codebase đi kèm bộ kiểm thử toàn diện 100% bằng Vitest:

### Chạy toàn bộ các bài kiểm thử:
```bash
npm test
```

### Chạy theo từng nhóm kiểm thử chuyên biệt:
```bash
# 1. Chạy Unit Test (Canonicalization, Hashing, Change Detector)
npm run test:unit

# 2. Chạy Integration Test (Webhook, Excel, Polling Scheduler)
npm run test:integration

# 3. Chạy Concurrency Test (CT-01, CT-02, CT-03, CT-04)
npm run test:concurrency

# 4. Chạy Failure Injection & Recovery Test (FT-01, FT-02)
npm run test:failure
```

### Kịch bản kiểm thử tải đột biến với k6 (Spike Load Testing):
Nếu máy có cài đặt công cụ `k6`, thực thi:
```bash
k6 run tests/load/k6-spike-test.js
```

---

## 7. Bảng đối chiếu tiêu chí nghiệm thu (Acceptance Criteria)

| Mã yêu cầu | Yêu cầu nghiệp vụ | Trạng thái triển khai | Vị trí mã nguồn kiểm chứng |
|---|---|---|---|
| **FR-01** | Giả lập Vietful Inventory Service | Đã hoàn thành | `apps/inventory-emulator/` |
| **FR-02** | Scheduled Polling với Checkpoint | Đã hoàn thành | `apps/cdms/src/ingestion/polling/` |
| **FR-03** | Webhook Callback hỗ trợ Idempotency | Đã hoàn thành | `apps/cdms/src/api/controllers/webhook.controller.ts` |
| **FR-04** | Upload Excel `.xlsx` có thống kê chi tiết | Đã hoàn thành | `apps/cdms/src/ingestion/excel/` |
| **FR-05** | Chỉ lưu dữ liệu mới/thay đổi | Đã hoàn thành | `apps/cdms/src/processing/detector/` |
| **NFR-01** | Exactly-once update effect tại Database | Đã hoàn thành | `tests/concurrency/concurrent.test.ts` (CT-01 đến CT-04) |
| **NFR-02** | Chống chịu lỗi và khôi phục giao dịch | Đã hoàn thành | `tests/failure/failure.test.ts` (FT-01, FT-02) |
| **NFR-03** | Khả năng container hóa bằng Docker Compose | Đã hoàn thành | `docker-compose.yml`, `Dockerfile.*` |

---

## 8. Tuyên bố sử dụng AI (AI Usage Disclosure)

Tuân thủ quy định tại mục 19 của tài liệu `DESIGN.md`:

### Các phần có sự hỗ trợ của AI:
- Gợi ý cấu trúc phân tầng kiến trúc và phác thảo tài liệu kỹ thuật ban đầu.
- Hỗ trợ xây dựng các kịch bản kiểm thử cạnh tranh (Concurrency Tests) và phục hồi lỗi (Failure Tests).
- Đề xuất các cấu hình tối ưu TypeScript compiler flags và container multi-stage build.

### Các phần do người phát triển chịu trách nhiệm và làm chủ:
- Ra quyết định lựa chọn kiến trúc xử lý Exactly-Once tập trung tại một pipeline chung.
- Triển khai toàn bộ mã nguồn logic nghiệp vụ, quản lý transaction và cơ chế băm dữ liệu tất định.
- Rà soát, gỡ lỗi và kiểm chứng thực nghiệm 100% các bài test trước khi đóng gói phát hành.
