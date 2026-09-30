# SPEC.md — Change Data Management Service (CDMS)

> Nguồn yêu cầu: `FullStack_BàiTest.pdf` — Change Data Management Service Project at kSynerX.  
> Tài liệu này tách **yêu cầu bắt buộc** từ đề bài và bổ sung **tiêu chí nghiệm thu đề xuất** để dễ phát triển/test.  
> Những phần ghi `[ĐỀ XUẤT]` không phải yêu cầu nguyên văn của đề bài.

---

## 1. Mục tiêu

Xây dựng prototype **Change Data Management Service (CDMS)** chỉ lưu **dữ liệu mới/thay đổi**, với các mục tiêu chính:

1. Mô phỏng một Inventory Service có chức năng giới hạn.
2. CDMS nhận dữ liệu bằng nhiều cơ chế.
3. Đảm bảo **exactly-once update** ngay cả khi có lỗi/retry.
4. Kiểm thử khi có **spike load** và nhiều cơ chế xử lý đồng thời.
5. Chạy trên **một máy** và được **container hóa**.

---

## 2. Phạm vi hệ thống

### 2.1 Thành phần bắt buộc

- **Emulating Vietful Inventory Service**
  - Mô phỏng Inventory API.
  - Dữ liệu tập trung vào `Product`.
  - Dữ liệu test được sinh bằng Faker.

- **Change Data Management Service**
  - Nhận dữ liệu bằng 3 cơ chế:
    1. Scheduled polling.
    2. Webhook callback.
    3. Upload Excel qua REST API.
  - Phát hiện và chỉ lưu dữ liệu mới/thay đổi.

- **Change Database**
  - Công nghệ bắt buộc: **PostgreSQL**.

- **Emulating Callback Client / REST Client**
  - Dùng để mô phỏng callback và upload file.

---

## 3. Yêu cầu chức năng

### FR-01 — Mô phỏng Inventory Service

Hệ thống phải có Inventory Service giả lập cung cấp dữ liệu Product để CDMS có thể query.

**Acceptance criteria [ĐỀ XUẤT]:**
- Có endpoint lấy danh sách product.
- Có endpoint lấy product theo ID.
- Có cách tạo/cập nhật product phục vụ demo/test.
- Product có trường `updatedAt` hoặc version tương đương để nhận biết thứ tự thay đổi.

---

### FR-02 — Scheduled polling

CDMS phải có khả năng query Inventory Service theo lịch được cấu hình trước.

**Acceptance criteria [ĐỀ XUẤT]:**
- Interval/cadence có thể cấu hình.
- Một lần polling có thể lấy nhiều product.
- Retry không được tạo bản ghi trùng.
- Sau restart, hệ thống tiếp tục chạy được mà không phá vỡ exactly-once.

---

### FR-03 — Webhook callback

CDMS phải có REST endpoint nhận dữ liệu thay đổi do callback client/inventory service đẩy vào.

**Acceptance criteria [ĐỀ XUẤT]:**
- Endpoint nhận JSON payload.
- Payload hợp lệ được xử lý idempotent.
- Gửi lại cùng một event nhiều lần không tạo duplicate.
- Nếu CDMS commit DB nhưng response bị mất, retry vẫn không tạo duplicate.

---

### FR-04 — Upload Excel

CDMS phải nhận file Excel qua REST API.

**Acceptance criteria [ĐỀ XUẤT]:**
- Hỗ trợ `.xlsx`.
- Validate header và row.
- Row hợp lệ được đưa qua cùng pipeline xử lý change.
- Upload lại cùng file hoặc cùng row không tạo duplicate.
- Có response thống kê `processed / inserted / duplicate / invalid`.

---

### FR-05 — Chỉ lưu dữ liệu mới/thay đổi

CDMS không được lưu dữ liệu cũ hoặc dữ liệu trùng.

**Quy tắc [ĐỀ XUẤT]:**
- Nếu payload giống trạng thái đã lưu gần nhất của product → `NO_CHANGE`.
- Nếu update có timestamp/version cũ hơn trạng thái hiện tại → `STALE`.
- Nếu là trạng thái mới hơn và nội dung thay đổi → `INSERTED`.
- Nếu cùng event được retry → `DUPLICATE_EVENT`.

---

### FR-06 — Exactly-once update

Mỗi thay đổi logic chỉ được ghi **một lần** vào Change Database.

**Acceptance criteria [ĐỀ XUẤT]:**
- Exactly-once được bảo vệ ở tầng database bằng transaction + unique constraint.
- Không dựa duy nhất vào kiểm tra duplicate ở application memory.
- Có integration test chứng minh retry/concurrency không tạo duplicate.

---

### FR-07 — Xử lý lỗi

CDMS phải hoạt động đúng khi xảy ra lỗi ở:

- CDMS.
- Inventory/Vietful emulator.
- PostgreSQL.
- Máy/process đang host CDC/callback.

**Acceptance criteria [ĐỀ XUẤT]:**
- Có retry với backoff cho lỗi tạm thời.
- Lỗi không làm mất dữ liệu đã commit.
- Request/event chưa commit có thể retry an toàn.
- Service restart không tạo duplicate.

---

### FR-08 — Concurrent ingestion

Ba cơ chế ingestion có thể chạy đồng thời.

**Acceptance criteria [ĐỀ XUẤT]:**
- Scheduled polling, webhook và Excel upload có thể cùng ghi product.
- Race condition không tạo duplicate hoặc ghi đè sai thứ tự.
- Database là nguồn sự thật cuối cùng cho idempotency.

---

### FR-09 — Spike load test

Phải có kiểm thử spike/concurrent processing.

**Acceptance criteria [ĐỀ XUẤT]:**
- Có script load test tái lập được.
- Đo ít nhất:
  - throughput,
  - latency,
  - error rate,
  - duplicate count.
- Duplicate count sau test phải bằng `0`.

---

## 4. Yêu cầu phi chức năng

### NFR-01 — Single machine

Toàn bộ prototype phải chạy được trên một máy.

### NFR-02 — Containerized deployment

Các service phải triển khai bằng container.

**[ĐỀ XUẤT]**
- Docker Compose để chạy:
  - `cdms`
  - `inventory-emulator`
  - `postgres`

### NFR-03 — Persistence

PostgreSQL dùng volume để dữ liệu không mất khi restart container.

### NFR-04 — Observability [ĐỀ XUẤT]

Log phải đủ để trace:

- `requestId`
- `eventId/idempotencyKey`
- `productId`
- ingestion source
- processing result
- error

### NFR-05 — Configuration [ĐỀ XUẤT]

Cấu hình qua environment variables:

- DB connection.
- Inventory service base URL.
- Polling schedule.
- Retry policy.
- Upload limits.

---

## 5. Data contract [ĐỀ XUẤT]

### Product

```json
{
  "id": "P-10001",
  "sku": "SKU-10001",
  "name": "Sample product",
  "quantity": 10,
  "price": 125000,
  "updatedAt": "2026-09-30T01:00:00.000Z"
}
```

> Field thực tế có thể điều chỉnh theo Product API mà bạn implement từ tài liệu tham chiếu của đề bài.

---

## 6. Kết quả xử lý chuẩn [ĐỀ XUẤT]

```text
INSERTED
NO_CHANGE
STALE
DUPLICATE_EVENT
INVALID
FAILED_RETRYABLE
FAILED_FINAL
```

---

## 7. API tối thiểu [ĐỀ XUẤT]

### CDMS

```http
POST /api/v1/webhooks/products
POST /api/v1/imports/products/excel
GET  /api/v1/changes
GET  /health
GET  /ready
```

### Inventory Emulator

```http
GET   /api/products
GET   /api/products/:id
POST  /api/products
PATCH /api/products/:id
GET   /health
```

---

## 8. Out of scope [ĐỀ XUẤT]

Để prototype không bị phình scope:

- Không cần UI phức tạp.
- Không cần Kafka/RabbitMQ nếu PostgreSQL transaction đã đủ chứng minh exactly-once.
- Không cần distributed deployment.
- Không cần authentication enterprise-grade trừ khi muốn mở rộng.
- Không cần CDC ở mức WAL/PostgreSQL logical replication; bài toán ở đây là ingestion/change management ở tầng service.

---

## 9. Definition of Done

Prototype được xem là hoàn thành khi:

- Chạy được bằng container trên một máy.
- Có PostgreSQL.
- Có Inventory Emulator.
- Có 3 cơ chế ingestion.
- Có exactly-once test.
- Có failure/retry test.
- Có spike/concurrency test.
- Có Git repository.
- Có tài liệu Markdown.
- Có demo flow.
- Có `LESSONS_LEARNED.md` hoặc section tương đương.
- Nêu rõ:
  - feature đã làm,
  - feature chưa làm,
  - code do candidate viết,
  - phần có sử dụng AI hỗ trợ.

---

## 10. Traceability matrix

| Requirement | Test đề xuất |
|---|---|
| Scheduled polling | Integration test + restart test |
| Webhook callback | Retry same event 10–100 lần |
| Excel upload | Re-upload same file + duplicate rows |
| Exactly-once | Unique constraint + concurrent request test |
| Failure handling | Kill/restart service + DB unavailable test |
| Spike load | k6 spike test |
| Single machine | Docker Compose |
| Containerized | `docker compose up --build` |
