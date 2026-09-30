# DESIGN.md — CDMS Detailed Design

> Đây là thiết kế triển khai chi tiết cho bài test.  
> Theo yêu cầu: Phần Back End được triển khai trên nền tảng **Python 3 + FastAPI + Pydantic + PostgreSQL**.

---

## 1. Repository structure

```text
cdms-project/
├─ src/
│  ├─ cdms/
│  │  ├─ api/
│  │  │  └─ router.py
│  │  ├─ config.py
│  │  ├─ domain/
│  │  │  ├─ models.py
│  │  │  └─ exceptions.py
│  │  ├─ ingestion/
│  │  │  ├─ webhook.py
│  │  │  ├─ excel.py
│  │  │  └─ polling.py
│  │  ├─ processing/
│  │  │  ├─ canonical.py
│  │  │  ├─ idempotency.py
│  │  │  ├─ detector.py
│  │  │  └─ pipeline.py
│  │  ├─ repositories/
│  │  │  ├─ change_repo.py
│  │  │  ├─ idempotency_repo.py
│  │  │  └─ checkpoint_repo.py
│  │  ├─ db/
│  │  │  ├─ client.py
│  │  │  ├─ memory_db.py
│  │  │  ├─ postgres_db.py
│  │  │  └─ migrations/
│  │  │     └─ 001_initial_schema.sql
│  │  └─ main.py
│  │
│  └─ emulator/
│     ├─ store.py
│     ├─ seed.py
│     └─ main.py
│
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ concurrency/
│  ├─ failure/
│  └─ load/
├─ docker-compose.yml
├─ Dockerfile.cdms
├─ Dockerfile.emulator
├─ requirements.txt
├─ pytest.ini
├─ SPEC.md
├─ ARCHITECTURE.md
├─ DESIGN.md
├─ PLAN.md
├─ CODING_STANDARDS.md
├─ README.md
└─ .env.example
```

---

## 2. Domain model

```ts
type IngestionSource = "POLL" | "WEBHOOK" | "EXCEL";

interface ProductPayload {
  id: string;
  sku?: string;
  name?: string;
  quantity?: number;
  price?: number;
  updatedAt: string;
}

interface NormalizedChange {
  productId: string;
  source: IngestionSource;
  sourceUpdatedAt: Date;
  payload: ProductPayload;
  payloadHash: string;
  idempotencyKey: string;
}
```

---

## 3. Canonicalization

Hash phải ổn định giữa các ingestion source.

Pseudo-code:

```ts
function normalizeProduct(input: unknown): ProductPayload {
  const p = ProductSchema.parse(input);

  return {
    id: p.id.trim(),
    sku: p.sku?.trim(),
    name: p.name?.trim(),
    quantity: Number(p.quantity),
    price: Number(p.price),
    updatedAt: new Date(p.updatedAt).toISOString(),
  };
}
```

Stable JSON:

```ts
function canonicalJson(value: object): string {
  return JSON.stringify(sortKeysRecursively(value));
}
```

Hash:

```ts
payloadHash = sha256(canonicalJson(normalizedPayload));
```

---

## 4. Idempotency key design

### 4.1 Webhook

Ưu tiên client gửi:

```http
Idempotency-Key: <event-id>
```

Nếu không có, derive:

```text
WEBHOOK:{productId}:{updatedAt}:{payloadHash}
```

### 4.2 Polling

```text
POLL:{productId}:{updatedAt}:{payloadHash}
```

### 4.3 Excel

```text
EXCEL:{fileHash}:{rowNumber}:{productId}:{payloadHash}
```

> `productId + payloadHash` vẫn là lớp dedup thứ hai ở bảng `product_changes`.

---

## 5. Database schema

### 5.1 Migration

```sql
CREATE TABLE ingestion_events (
    id BIGSERIAL PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE TABLE product_changes (
    id BIGSERIAL PRIMARY KEY,
    product_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_updated_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL,
    payload_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_product_payload
      UNIQUE (product_id, payload_hash)
);

CREATE INDEX idx_product_changes_latest
ON product_changes(product_id, source_updated_at DESC, id DESC);

CREATE TABLE polling_checkpoints (
    source TEXT PRIMARY KEY,
    last_updated_at TIMESTAMPTZ,
    cursor TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6. Core processing algorithm

```ts
async function processChange(change: NormalizedChange): Promise<Result> {
  return db.transaction(async (tx) => {
    const event = await tx.insertIngestionEventIfAbsent(change);

    if (!event.inserted) {
      return { status: "DUPLICATE_EVENT" };
    }

    await tx.advisoryLock(change.productId);

    const latest = await tx.getLatestProductChange(change.productId);

    if (latest) {
      if (change.sourceUpdatedAt < latest.sourceUpdatedAt) {
        await tx.markEventProcessed(change.idempotencyKey, "STALE");
        return { status: "STALE" };
      }

      if (change.payloadHash === latest.payloadHash) {
        await tx.markEventProcessed(change.idempotencyKey, "NO_CHANGE");
        return { status: "NO_CHANGE" };
      }
    }

    const inserted = await tx.insertProductChange(change);

    // Unique constraint is final safety net.
    if (!inserted) {
      await tx.markEventProcessed(change.idempotencyKey, "NO_CHANGE");
      return { status: "NO_CHANGE" };
    }

    await tx.markEventProcessed(change.idempotencyKey, "INSERTED");
    return { status: "INSERTED" };
  });
}
```

---

## 7. Concurrency detail

### PostgreSQL advisory lock

```sql
SELECT pg_advisory_xact_lock(hashtext($1));
```

`$1 = product_id`

Tác dụng:

- serialize các change cùng product trong transaction,
- tự release khi commit/rollback,
- không chặn product khác.

---

## 8. Webhook API design

### Request

```http
POST /api/v1/webhooks/products
Content-Type: application/json
Idempotency-Key: evt-123
```

```json
{
  "id": "P-1",
  "name": "Product 1",
  "quantity": 15,
  "price": 100000,
  "updatedAt": "2026-09-30T01:00:00Z"
}
```

### Response

```json
{
  "requestId": "req-...",
  "status": "INSERTED",
  "productId": "P-1"
}
```

Duplicate retry:

```json
{
  "requestId": "req-...",
  "status": "DUPLICATE_EVENT",
  "productId": "P-1"
}
```

---

## 9. Excel import design

Expected header [ĐỀ XUẤT]:

```text
id | sku | name | quantity | price | updatedAt
```

### Endpoint

```http
POST /api/v1/imports/products/excel
Content-Type: multipart/form-data
```

### Response

```json
{
  "file": "products.xlsx",
  "rows": 1000,
  "inserted": 130,
  "noChange": 740,
  "stale": 20,
  "duplicate": 100,
  "invalid": 10
}
```

### Processing strategy

Prototype:

```text
parse file
  -> validate each row
  -> process in controlled concurrency (e.g. 10–20)
  -> aggregate result
```

Không nên `Promise.all()` cho hàng chục nghìn row không giới hạn.

---

## 10. Polling design

Configuration:

```env
POLLING_ENABLED=true
POLLING_CRON=*/10 * * * * *
INVENTORY_BASE_URL=http://inventory-emulator:3001
```

Flow:

```text
load checkpoint
  -> fetch products changed after checkpoint
  -> process each product
  -> advance checkpoint only after batch succeeds
```

### Checkpoint rule

Không advance checkpoint nếu batch chưa được xử lý an toàn.

Nếu API không hỗ trợ cursor, có thể dùng:

```text
updatedAt >= lastCheckpoint
```

và dựa vào idempotency để xử lý overlap.

---

## 11. Retry policy

Retry chỉ dành cho lỗi tạm thời:

- timeout,
- connection reset,
- HTTP 429,
- HTTP 5xx,
- database transient error.

Không retry:

- invalid payload,
- unsupported file,
- schema validation error.

Backoff [ĐỀ XUẤT]:

```text
250ms -> 500ms -> 1s -> 2s
```

kèm jitter.

---

## 12. HTTP status design [ĐỀ XUẤT]

| Situation | HTTP |
|---|---:|
| Inserted / duplicate / no-change | 200 |
| Accepted async import (nếu chọn async) | 202 |
| Invalid payload | 400 |
| Unsupported file | 415 |
| Temporary dependency failure | 503 |
| Unexpected error | 500 |

---

## 13. Logging

Structured log example:

```json
{
  "level": "info",
  "requestId": "req-123",
  "idempotencyKey": "evt-123",
  "source": "WEBHOOK",
  "productId": "P-1",
  "result": "INSERTED",
  "durationMs": 18
}
```

Không log full payload nếu payload có dữ liệu nhạy cảm trong phiên bản mở rộng.

---

## 14. Health checks

### `/health`

Service process còn sống.

### `/ready`

Kiểm tra:

- PostgreSQL reachable.
- Required configuration loaded.

Inventory service có thể không bắt buộc để CDMS nhận webhook/excel vẫn hoạt động; readiness policy cần ghi rõ trong README.

---

## 15. Failure-injection tests

### FT-01 — Lost response

1. Send webhook.
2. DB commit.
3. Giả lập connection bị đóng trước response.
4. Retry cùng `Idempotency-Key`.
5. Assert chỉ 1 `product_changes`.

### FT-02 — Crash before commit

1. Begin processing.
2. Kill CDMS trước commit.
3. Restart.
4. Retry.
5. Assert 1 change.

### FT-03 — Database unavailable

1. Stop PostgreSQL.
2. Send webhook.
3. Assert request fail/retryable.
4. Start DB.
5. Retry same event.
6. Assert exactly 1 change.

### FT-04 — Inventory unavailable

1. Stop inventory emulator.
2. Poll fails.
3. Start inventory.
4. Next poll succeeds.
5. Assert no lost/duplicate change.

---

## 16. Concurrent tests

### CT-01 — Same event x100

```text
100 concurrent POST with same Idempotency-Key
Expected: 1 database effect
```

### CT-02 — Same product from 3 sources

```text
Webhook + Poll + Excel
same product
same payload
Expected: 1 unique change
```

### CT-03 — Ordered changes

```text
v1 @ 10:00
v2 @ 10:05
v3 @ 10:10
```

Expected: insert 3 distinct states.

### CT-04 — Stale arrival

```text
v2 arrives first
v1 arrives later
```

Expected: v1 = `STALE`.

---

## 17. Spike test

`k6` scenario [ĐỀ XUẤT]:

```text
0 -> 50 VUs in 10s
50 -> 200 VUs in 5s
hold 200 VUs for 20s
200 -> 0
```

Metrics:

- `http_req_duration`
- `http_req_failed`
- request count
- final DB row count
- duplicate row count

Correctness requirement quan trọng nhất:

```text
duplicate database effects = 0
```

Performance threshold nên được báo cáo theo máy chạy test thay vì tuyên bố con số tuyệt đối không có căn cứ từ đề bài.

---

## 18. Security / input safety tối thiểu

- File size limit.
- `.xlsx` MIME/extension validation.
- Schema validation.
- SQL parameter binding.
- Request body limit.
- Timeout tới dependency.
- Không interpolate raw input vào SQL.

---

## 19. AI usage disclosure

Trong README/demo có section:

```md
## AI usage

Candidate-owned work:
- Định hướng kiến trúc, phân tích bài toán và các ràng buộc phi chức năng (Single machine, Exactly-Once, Resilience).
- Kỹ thuật thiết kế prompt chi tiết (Prompt Engineering & Data Contract Specification) để chỉ đạo AI sinh mã nguồn.
- Ra quyết định kỹ thuật cốt lõi: pipeline xử lý tập trung, thuật toán băm tất định (recursive sort keys + SHA-256), cơ chế lock theo sản phẩm.
- Rà soát mã nguồn, sửa lỗi logic, tối ưu hóa và kiểm chứng thực nghiệm 100% các bài test (Pytest, Concurrency, Failure).
- Trình bày, giải thích và chịu trách nhiệm toàn diện về giải pháp trong buổi bảo vệ/demo.

AI was used for:
- Sinh mã nguồn khung (boilerplate / scaffolding) theo đúng prompt kỹ thuật chi tiết của ứng viên.
- Chuyển đổi mã nguồn và định dạng sang chuẩn Python (FastAPI, Pydantic v2, Asyncpg).
- Đề xuất và mở rộng các test fixtures, kịch bản kiểm thử cạnh tranh (Concurrency) và tiêm lỗi (Failure).
- Hỗ trợ rà soát cú pháp tài liệu kỹ thuật theo định hướng kiến trúc đã vạch ra.
```

Điều quan trọng là khai báo đúng thực tế bạn đã dùng AI ở đâu.
