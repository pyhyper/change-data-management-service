# CODING_STANDARDS.md — CDMS Coding Standards & Engineering Rules

> Tài liệu này thiết lập toàn bộ quy chuẩn lập trình, quy tắc thiết kế mã nguồn, an toàn dữ liệu và quy trình phát triển cho hệ thống Change Data Management Service (CDMS).  
> Mọi thành viên phát triển và kiểm thử bắt buộc tuân thủ các quy tắc trong tài liệu này để bảo đảm tính đúng đắn, nhất quán và khả năng bảo trì lâu dài của hệ thống.

---

## 1. Mục tiêu và phạm vi áp dụng

### 1.1 Mục tiêu
- Đảm bảo tính nhất quán trên toàn bộ codebase của hệ thống CDMS.
- Ngăn ngừa lỗi xử lý dữ liệu trùng lặp, bảo đảm tính toàn vẹn và nguyên tắc exactly-once update.
- Chuẩn hóa cấu trúc thư mục, quy ước đặt tên, xử lý lỗi và logging.
- Nâng cao tính khả thi trong việc kiểm thử tự động, tích hợp liên tục và rà soát mã nguồn.

### 1.2 Phạm vi áp dụng
- Dịch vụ cốt lõi: `apps/cdms` (API, Polling Worker, Processing Pipeline, Repository).
- Dịch vụ giả lập: `apps/inventory-emulator`.
- Bộ công cụ kiểm thử: `tests/integration`, `tests/failure`, `tests/load`.
- Mã nguồn tiện ích, migration script, và các file cấu hình hạ tầng liên quan.

---

## 2. Nguyên tắc kỹ thuật cốt lõi

1. **Correctness First (Tính đúng đắn là trên hết)**
   - Hệ thống xử lý dữ liệu thay đổi ưu tiên tính chính xác dữ liệu trước mọi tối ưu hiệu năng.
   - Tuyệt đối không hy sinh tính toàn vẹn (idempotency, concurrency control) để đạt độ trễ thấp hơn nếu chưa có bằng chứng nghẽn cổ chai cụ thể.

2. **Explicit over Implicit (Rõ ràng hơn ngầm định)**
   - Khai báo kiểu tường minh, không sử dụng ép kiểu ngầm định.
   - Luồng dữ liệu và các tác dụng phụ (side-effects) phải được thể hiện trực tiếp qua tham số và giá trị trả về, không sử dụng biến toàn cục hoặc trạng thái ẩn.

3. **Single Responsibility Principle (Trách nhiệm đơn lẻ)**
   - Mỗi hàm, lớp, module chỉ đảm nhiệm một vai trò duy nhất.
   - Tách biệt rõ ràng giữa tầng tiếp nhận (Ingestion), chuẩn hóa (Normalization), nhận diện thay đổi (Change Detection), và lưu trữ (Repository).

4. **Fail-Fast & Boundary Validation (Xác thực tại ranh giới)**
   - Toàn bộ dữ liệu đi vào hệ thống từ bên ngoài (HTTP payload, query param, file Excel, phản hồi từ bên thứ ba) phải được xác thực ngay tại ranh giới tầng vào trước khi chuyển vào lõi nghiệp vụ.

5. **Deterministic Processing (Xử lý tất định)**
   - Thuật toán chuẩn hóa và sinh hash dữ liệu phải luôn cho ra một kết quả duy nhất với cùng một nội dung đầu vào, bất kể thứ tự key trong JSON hay định dạng thời gian ban đầu.

---

## 3. Quy chuẩn Ngôn ngữ Lập trình (Python & TypeScript)

### 3.1 Quy chuẩn Backend Python (PEP 8 & Pydantic v2)
1. **Tiêu chuẩn phiên bản:** Python 3.11+ (khuyến nghị Python 3.13).
2. **Khai báo kiểu dữ liệu bắt buộc (Type Hints):**
   - Mọi hàm, phương thức, thuộc tính bắt buộc khai báo Type Annotations (`typing`).
   - Sử dụng Pydantic v2 `BaseModel` để validate toàn bộ dữ liệu đi vào hệ thống (DTO).
   - Hạn chế dùng `Any`; ưu tiên dùng TypeVar, Union, hoặc Generic có ràng buộc.
3. **Lập trình Bất đồng bộ (Asyncio):**
   - Tận dụng `async/await` với FastAPI, `httpx.AsyncClient` và `asyncpg`.
   - Cấm sử dụng các lời gọi blocking I/O (như `time.sleep()`, đồng bộ socket) trong async loop; bắt buộc dùng `asyncio.sleep()` hoặc offload sang thread pool.
4. **Định dạng mã nguồn:** Tuân thủ chặt chẽ PEP 8 (indentation 4 spaces, snake_case cho hàm/biến, PascalCase cho class, UPPER_SNAKE_CASE cho hằng số).

### 3.2 Cấu hình trình biên dịch TypeScript (Tham chiếu)
Dự án bắt buộc bật các cờ nghiêm ngặt sau:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

### 3.2 Quy định về kiểu dữ liệu (Typing Rules)
- **Cấm sử dụng kiểu `any`:** Trong mọi trường hợp, không dùng `any`. Nếu chưa xác định được kiểu cụ thể, dùng `unknown` và tiến hành type guard hoặc parse qua schema validator trước khi sử dụng.
- **Hạn chế Type Assertion (`as Type`):** Không dùng `as` để bypass kiểm tra kiểu của TypeScript. Chỉ chấp nhận assertion khi làm việc với thư viện ngoài thiếu type definition chuẩn, và phải đi kèm ghi chú giải thích.
- **Sử dụng `interface` và `type` đúng mục đích:**
  - Dùng `interface` để định nghĩa hợp đồng của Object, Service, Repository có thể kế thừa hoặc implement.
  - Dùng `type` cho Union types, Intersection types, Tuple, Primitive alias, hoặc Utility types.
- **Thuộc tính bất biến (Immutability):**
  - Khai báo biến mặc định bằng `const`. Chỉ dùng `let` khi thực sự cần thay đổi giá trị. Cấm dùng `var`.
  - Dùng `readonly` cho các thuộc tính đối tượng không được phép sửa đổi sau khi khởi tạo.

Ví dụ chuẩn:

```ts
// ĐÚNG
export interface ProductChangeCommand {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly quantity: number;
  readonly price: number;
  readonly sourceUpdatedAt: Date;
}

// SAI
export interface ProductChangeCommand {
  productId: any;
  sku?: string;
  name: any;
  quantity: number;
  price: number;
  sourceUpdatedAt: any;
}
```

### 3.3 Xử lý bất đồng bộ (Asynchronous Code)
- Luôn sử dụng cú pháp `async/await`. Cấm sử dụng callback style lồng nhau hoặc chuỗi `.then().catch()` trộn lẫn với `async/await`.
- Tất cả các Promise trả về phải được xử lý hoặc await. Tuyệt đối không để xảy ra unhandled promise rejections.
- Khi cần thực thi nhiều tác vụ song song độc lập, sử dụng `Promise.all()` hoặc `Promise.allSettled()`. Nếu các tác vụ phụ thuộc thứ tự, phải thực thi tuần tự.

---

## 4. Quy ước đặt tên (Naming Conventions)

### 4.1 Bảng quy chuẩn tổng quát

| Thành phần | Quy tắc | Ví dụ chuẩn | Ví dụ sai |
|---|---|---|---|
| Thư mục | `kebab-case` | `change-detector`, `excel-parser` | `ChangeDetector`, `excel_parser` |
| Tệp mã nguồn | `kebab-case.ts` | `product.repository.ts`, `hash.util.ts` | `productRepository.ts`, `HashUtil.ts` |
| Lớp (Class) | `PascalCase` | `PostgresChangeRepository`, `ChangePipeline` | `postgres_change_repository`, `changePipeline` |
| Giao diện (Interface) | `PascalCase` | `ProductRepository`, `IdempotencyHandler` | `IProductRepository`, `product_interface` |
| Kiểu (Type alias) | `PascalCase` | `IngestionSource`, `NormalizationResult` | `ingestion_source`, `TNormalization` |
| Biến / Thuộc tính | `camelCase` | `payloadHash`, `retryCount`, `updatedAt` | `payload_hash`, `RetryCount` |
| Hàm / Phương thức | `camelCase` (động từ) | `calculateHash()`, `findProductById()` | `Hash()`, `product_by_id()` |
| Hằng số toàn cục | `UPPER_SNAKE_CASE` | `MAX_RETRY_ATTEMPTS`, `DEFAULT_BATCH_SIZE` | `maxRetryAttempts`, `default_batch` |
| Biến logic (Boolean) | Tiền tố vị ngữ (`is`, `has`, `can`, `should`) | `isDuplicate`, `hasChanged`, `canRetry` | `duplicate`, `changed`, `retryFlag` |
| Bảng cơ sở dữ liệu | `snake_case` (số nhiều) | `change_records`, `idempotency_keys` | `ChangeRecords`, `changeRecord` |
| Cột cơ sở dữ liệu | `snake_case` | `product_id`, `payload_hash`, `created_at` | `productId`, `PayloadHash` |

### 4.2 Quy định về tiền tố Interface
Không đặt tiền tố `I` trước tên Interface (ví dụ: dùng `ProductRepository`, không dùng `IProductRepository`). Lý do: người dùng interface chỉ cần quan tâm đến hợp đồng kiểu dữ liệu, không cần biết đó là interface hay abstract class.

### 4.3 Quy tắc đặt tên tệp theo đuôi phụ trách (Suffix Convention)
- Controller: `*.controller.ts` (ví dụ: `webhook.controller.ts`)
- Service: `*.service.ts` (ví dụ: `idempotency.service.ts`)
- Repository: `*.repository.ts` (ví dụ: `change.repository.ts`)
- Pipeline / Processor: `*.processor.ts` (ví dụ: `change.processor.ts`)
- Schema validation: `*.schema.ts` (ví dụ: `product.schema.ts`)
- Tiện ích: `*.util.ts` (ví dụ: `canonical.util.ts`)
- Kiểm thử: `*.test.ts` hoặc `*.spec.ts` (ví dụ: `change.processor.test.ts`)

---

## 5. Cấu trúc mã nguồn và phân tầng trách nhiệm

### 5.1 Cấu trúc cây thư mục chuẩn
Mã nguồn phải tuân theo cấu trúc phân tầng sạch (Clean Architecture / Layered Architecture) như sau:

```text
apps/cdms/src/
├── api/                  # Tầng nhận HTTP Request, routing, parsing request header/body
│   ├── controllers/      # Điều phối request, gọi tầng processing/service
│   ├── middlewares/      # Error handler, request logger, auth/rate limit
│   └── routes/           # Định tuyến URL cho các endpoint
├── config/               # Load và validate biến môi trường
├── domain/               # Core entities, interfaces, business rules độc lập
│   ├── models/           # Định nghĩa các type/interface cốt lõi
│   └── errors/           # Các domain error class định nghĩa trước
├── ingestion/            # Triển khai 3 nguồn dữ liệu đầu vào
│   ├── webhook/          # Nhận webhook event
│   ├── excel/            # Đọc, parse và validate file Excel
│   └── polling/          # Worker quét dữ liệu từ Inventory Service theo chu kỳ
├── processing/           # Lõi xử lý dữ liệu thay đổi
│   ├── canonical/        # Chuẩn hóa dữ liệu và tính hash ổn định
│   ├── detector/         # So sánh trạng thái để xác định dữ liệu mới/thay đổi
│   └── pipeline/         # Điều phối luồng xử lý chung cho 3 nguồn ingestion
├── repositories/         # Giao tiếp với cơ sở dữ liệu (PostgreSQL / In-memory)
│   ├── change_repo.py
│   ├── idempotency_repo.py
│   └── checkpoint_repo.py
├── db/                   # Database connection pool (asyncpg), migrations, MemoryDatabaseClient
└── main.py               # Bootstrap và khởi tạo FastAPI server
```

### 5.2 Quy tắc phụ thuộc giữa các tầng (Dependency Rules)
1. Tầng ngoài phụ thuộc tầng trong, tuyệt đối không có chiều ngược lại:
   - `api` và `ingestion` phụ thuộc vào `processing` và `domain`.
   - `processing` phụ thuộc vào `domain` và `repositories`.
   - `repositories` chỉ phụ thuộc vào `domain` và `db`.
   - `domain` là tầng độc lập cao nhất, không được import từ bất kỳ tầng nào khác ngoài utils thuần túy.
2. Không import vòng tròn (Circular Dependency). Mọi quan hệ phụ thuộc chéo phải được giải quyết qua Interface hoặc tách module chung.

---

## 6. Quy chuẩn chuẩn hóa và xử lý Exactly-Once

### 6.1 Chuẩn hóa dữ liệu (Canonicalization)
Để đảm bảo cùng một đối tượng dữ liệu từ 3 nguồn (Polling, Webhook, Excel) cho ra giá trị nhận diện giống nhau:
1. **Trim chuỗi ký tự:** Mọi giá trị string như `id`, `sku`, `name` phải được cắt bỏ khoảng trắng đầu/cuối (`strip()`).
2. **Chuẩn hóa số học:** Chuyển đổi định dạng số (string hoặc number) về kiểu `float` hoặc `int` chính xác, làm tròn theo quy tắc kế toán nếu có phần thập phân.
3. **Chuẩn hóa ngày tháng:** Mọi mốc thời gian phải được parse về UTC ISO-8601 string (`YYYY-MM-DDTHH:mm:ss+00:00`) trước khi so sánh hoặc tính hash.
4. **Sắp xếp khóa JSON (Deterministic Hash):** Trước khi tính hash SHA-256, toàn bộ các khóa trong object phải được sắp xếp theo thứ tự bảng chữ cái đệ quy.

```python
import hashlib
import json
from typing import Any

def sort_keys_recursively(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: sort_keys_recursively(obj[k]) for k in sorted(obj.keys())}
    if isinstance(obj, list):
        return [sort_keys_recursively(item) for item in obj]
    return obj

def compute_payload_hash(payload: dict[str, Any]) -> str:
    canonical = sort_keys_recursively(payload)
    serialized = json.dumps(canonical, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()
```

### 6.2 Chiến lược Idempotency
- Mọi thao tác xử lý bản ghi thay đổi phải được gán một `idempotency_key` duy nhất hoặc dựa vào `(product_id, payload_hash)`.
- Bảng quản lý idempotency trong PostgreSQL phải có Unique Constraint trên cột này.
- Khi gặp khóa đã tồn tại trong DB, hệ thống ghi nhận trạng thái trùng lặp (`DUPLICATE_IGNORED`), bỏ qua bước ghi dữ liệu và trả về kết quả thành công mà không gây lỗi hoặc tạo thêm bản ghi mới.

---

## 7. Quy chuẩn Cơ sở dữ liệu và Giao dịch (PostgreSQL)

### 7.1 Quy tắc thiết kế bảng và cột
- Tên bảng: Số nhiều, chữ thường, cách nhau bằng dấu gạch dưới (`snake_case`). Ví dụ: `change_records`, `idempotency_keys`.
- Khóa chính: Khuyến nghị dùng `UUID` hoặc `BIGSERIAL` có tính tăng dần.
- Khóa ngoại: Phải có tên rõ ràng theo quy ước `fk_<tên_bảng_nguồn>_<tên_bảng_đích>`.
- Chỉ mục (Index): Phải đặt tên theo quy ước `idx_<tên_bảng>_<tên_cột>`. Đối với unique index: `uq_<tên_bảng>_<tên_cột>`.
- Thời gian lưu trữ: Luôn có 2 cột `created_at` và `updated_at` kiểu `TIMESTAMPTZ` với giá trị mặc định `CURRENT_TIMESTAMP`.

### 7.2 Quản lý giao dịch (Transaction Management)
- **Ranh giới giao dịch rõ ràng:** Khi thực hiện chuỗi thao tác gồm kiểm tra idempotency, phát hiện thay đổi và ghi nhận lịch sử, toàn bộ logic PHẢI nằm trong cùng một Database Transaction.
- **Xử lý rollback an toàn:** Mọi transaction phải được bọc trong khối `try/catch`. Trong trường hợp phát sinh ngoại lệ, lệnh `ROLLBACK` phải được gọi trước khi ném lại lỗi lên tầng trên.
- **Tránh Transaction kéo dài:** Tuyệt đối không thực hiện các tác vụ I/O chậm (như gọi HTTP API, đọc file Excel dung lượng lớn) bên trong Database Transaction. Chỉ mở transaction tại thời điểm bắt đầu thao tác ghi dữ liệu vào DB.

```ts
import { PoolClient } from "pg";

export async function withTransaction<T>(
  client: PoolClient,
  action: (client: PoolClient) => Promise<T>
): Promise<T> {
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

### 7.3 Kiểm soát tương tranh (Concurrency Control)
- Sử dụng câu lệnh `INSERT ... ON CONFLICT DO NOTHING` hoặc `INSERT ... ON CONFLICT (...) DO UPDATE` để giải quyết xung đột khi có nhiều worker ghi cùng một bản ghi đồng thời.
- Nếu cần đọc và cập nhật một dòng dữ liệu quan trọng, sử dụng `SELECT ... FOR UPDATE` có kiểm soát thời gian chờ (lock timeout) để ngăn ngừa hiện tượng deadlock.

---

## 8. Quy chuẩn Xử lý Lỗi và Giao tiếp HTTP API

### 8.1 Mã phản hồi HTTP (HTTP Status Codes)
Chỉ sử dụng đúng ngữ nghĩa của các mã trạng thái chuẩn:
- `200 OK`: Yêu cầu xử lý thành công, có dữ liệu trả về hoặc đã ghi nhận idempotent.
- `201 Created`: Tạo mới thành công bản ghi thay đổi trong database.
- `400 Bad Request`: Payload sai định dạng cấu trúc, thiếu header bắt buộc.
- `422 Unprocessable Entity`: Dữ liệu đúng cấu trúc JSON nhưng vi phạm logic schema nghiệp vụ (ví dụ: số lượng âm, ID trống).
- `409 Conflict`: Xung đột phiên bản dữ liệu hoặc trạng thái không hợp lệ.
- `500 Internal Server Error`: Lỗi phát sinh ngoài dự kiến từ phía server.
- `502 Bad Gateway` / `503 Service Unavailable`: Dịch vụ phụ thuộc (Inventory Service, DB) không phản hồi hoặc quá tải.

### 8.2 Định dạng phản hồi lỗi chuẩn
Mọi lỗi trả về cho client phải tuân theo cấu trúc JSON đồng nhất:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Du lieu dau vao khong hop le",
    "details": [
      {
        "field": "price",
        "issue": "Price must be a positive number"
      }
    ],
    "requestId": "req-98765-abcd",
    "timestamp": "2026-09-30T09:00:00.000Z"
  }
}
```

### 8.3 Phân loại Exception trong mã nguồn
Tạo các lớp lỗi kế thừa từ `Error` cơ sở để phân biệt nguồn gốc lỗi:
- `ValidationError`: Lỗi dữ liệu đầu vào không hợp lệ (tương ứng HTTP 400/422).
- `ConflictError`: Lỗi xung đột tương tranh (tương ứng HTTP 409).
- `ExternalServiceError`: Lỗi khi kết nối hoặc nhận phản hồi từ Inventory Service (tương ứng HTTP 502/503).
- `DatabaseError`: Lỗi tầng truy vấn dữ liệu.

Tuyệt đối không để lộ stack trace hoặc thông tin mật (thông số kết nối database, file path nội bộ) trong response trả về cho client.

---

## 9. Quy chuẩn Logging và Giám sát (Observability)

### 9.1 Định dạng Log
- Bắt buộc log theo định dạng **JSON có cấu trúc (Structured JSON Log)** ra `stdout` (đối với log thường) hoặc `stderr` (đối với lỗi).
- Cấm sử dụng `console.log()` vô tội vạ trong mã nguồn production. Mọi tác vụ ghi log phải đi qua một Logger instance chung.

### 9.2 Các trường bắt buộc trong mỗi dòng Log

```json
{
  "timestamp": "2026-09-30T09:00:00.000Z",
  "level": "INFO",
  "service": "cdms-api",
  "traceId": "trace-123456",
  "message": "Change record processed successfully",
  "context": {
    "source": "WEBHOOK",
    "productId": "PROD-001",
    "action": "INSERTED",
    "durationMs": 14
  }
}
```

### 9.3 Mức độ Log (Log Levels)
- `ERROR`: Các lỗi làm gián đoạn luồng xử lý hoặc cần sự can thiệp của kỹ thuật (DB down, unhandled exception).
- `WARN`: Sự kiện bất thường nhưng hệ thống vẫn tự phục hồi hoặc tiếp tục được (retry lần thứ n, duplicate event bị bỏ qua).
- `INFO`: Các mốc quan trọng trong vòng đời ứng dụng (server khởi động, polling cycle hoàn thành, batch import kết thúc).
- `DEBUG`: Chi tiết dữ liệu phục vụ gỡ lỗi môi trường phát triển (payload chi tiết, câu query DB). Tắt ở môi trường production nếu không cần thiết.

### 9.4 Bảo mật thông tin trong Log (Sanitization)
- Tuyệt đối KHÔNG log mật khẩu, token xác thực, chuỗi kết nối chứa mật khẩu.
- Đối với dữ liệu lớn (như toàn bộ nội dung file Excel), chỉ log số lượng dòng và mã hash tóm tắt, không in toàn bộ raw data ra log.

---

## 10. Quy chuẩn Kiểm thử (Testing Standards)

### 10.1 Phân cấp kiểm thử
Hệ thống phải triển khai đủ 4 cấp độ kiểm thử:
1. **Unit Test:** Kiểm thử các hàm độc lập (canonicalization, hash calculation, schema validation, change detector logic). Chạy nhanh, không phụ thuộc cơ sở dữ liệu thật.
2. **Integration Test:** Kiểm thử tương tác giữa Service, Repository và cơ sở dữ liệu PostgreSQL thật (chạy qua Docker).
3. **Failure & Concurrency Test:** Kiểm thử các tình huống mất mạng, retry liên tục, gửi đồng thời nhiều event cho cùng một Product để chứng minh nguyên tắc exactly-once update.
4. **Load & Spike Test:** Dùng k6 để giả lập tải đột biến từ 3 nguồn ingestion đổ về cùng lúc.

### 10.2 Cấu trúc mã kiểm thử (Pattern AAA)
Mỗi test case phải tuân thủ nghiêm ngặt 3 bước:
- **Arrange:** Chuẩn bị dữ liệu mẫu, mock phụ thuộc.
- **Act:** Thực thi hàm/hành động cần kiểm thử.
- **Assert:** Kiểm tra kết quả trả về và trạng thái cơ sở dữ liệu.

```ts
describe("ChangeDetector", () => {
  it("should return CHANGED when payload hash differs from existing latest record", async () => {
    // Arrange
    const existingHash = "hash-version-1";
    const newCommand = createMockProductCommand({ quantity: 20 });
    const detector = new ChangeDetector();

    // Act
    const result = await detector.evaluate(existingHash, newCommand);

    // Assert
    expect(result.status).toBe("CHANGED");
    expect(result.hasChanged).toBe(true);
  });
});
```

### 10.3 Nguyên tắc cô lập dữ liệu kiểm thử
- Không để test case phụ thuộc thứ tự thực thi của nhau.
- Sau mỗi test case tương tác với database, phải dọn sạch dữ liệu vừa tạo hoặc chạy trong transaction tự động rollback để đảm bảo môi trường sạch cho test case tiếp theo.

---

## 11. Quy chuẩn Cấu hình và Môi trường (12-Factor App)

### 11.1 Quản lý biến môi trường
- Mọi giá trị cấu hình thay đổi theo môi trường (cổng port, DB credentials, polling interval, API URL của Inventory Emulator) phải được nạp qua biến môi trường (Environment Variables).
- Cấm hardcode các giá trị cấu hình bên trong mã nguồn.
- Cung cấp tệp `.env.example` chứa toàn bộ danh sách biến cấu hình mẫu với giá trị mặc định an toàn cho môi trường phát triển cục bộ.
- File `.env` chứa bí mật thực tế bắt buộc phải được khai báo trong `.gitignore`.

### 11.2 Xác thực cấu hình khi khởi động (Fail-Fast Configuration)
Tại thời điểm bootstrap ứng dụng (`app.ts`), toàn bộ biến môi trường phải được validate qua schema (ví dụ: dùng Zod). Nếu thiếu bất kỳ biến bắt buộc nào, ứng dụng phải dừng khởi động ngay lập tức và in rõ tên biến bị thiếu:

```ts
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  INVENTORY_SERVICE_URL: z.string().url("INVENTORY_SERVICE_URL must be a valid URL"),
  POLLING_INTERVAL_MS: z.coerce.number().default(10000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = EnvSchema.parse(process.env);
```

---

## 12. Quy chuẩn Git và Quy trình Đánh giá Mã nguồn (Code Review)

### 12.1 Quy ước đặt tên nhánh (Branch Naming)
Tên nhánh sử dụng chữ thường, phân tách bằng dấu gạch chéo và gạch nối:
- `feature/<tên-tính-năng>`: Thêm tính năng mới (ví dụ: `feature/excel-ingestion-pipeline`).
- `fix/<tên-lỗi>`: Sửa lỗi (ví dụ: `fix/idempotency-race-condition`).
- `test/<tên-kịch-bản>`: Thêm test case hoặc kịch bản tải (ví dụ: `test/k6-spike-load`).
- `refactor/<nội-dung>`: Tái cấu trúc mã nguồn không thay đổi logic (ví dụ: `refactor/normalize-module`).

### 12.2 Quy ước viết Commit Message theo chuẩn Conventional Commits 1.0.0

Mọi commit trong dự án bắt buộc phải tuân theo đặc tả chuẩn quốc tế **Conventional Commits 1.0.0**. Cấu trúc mỗi commit message bao gồm:

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

#### 1. Bảng danh mục Type chuẩn

| Type | Ý nghĩa và mục đích | Mức Semantic Versioning | Ví dụ thực tế trong dự án |
|---|---|---|---|
| `feat` | Thêm tính năng nghiệp vụ mới | MINOR (0.x.0) | `feat(ingestion): add streaming openpyxl parser for excel` |
| `fix` | Sửa lỗi trong mã nguồn | PATCH (0.0.x) | `fix(pipeline): prevent duplicate insertion under race condition` |
| `refactor` | Tái cấu trúc mã nguồn không đổi hành vi | PATCH (0.0.x) | `refactor(cleanup): remove nodejs files and migrate to python` |
| `perf` | Cải tiến tối ưu hiệu năng | PATCH (0.0.x) | `perf(canonical): optimize key sorting recursion for nested dict` |
| `test` | Thêm mới hoặc bổ sung bài kiểm thử | Không tăng version | `test(concurrency): add ct-01 scenario for 100 concurrent webhooks` |
| `docs` | Thêm hoặc sửa đổi tài liệu kỹ thuật | Không tăng version | `docs(spec): clarify acceptance criteria for scheduled polling` |
| `build` | Thay đổi file build hoặc dependencies | PATCH (0.0.x) | `build(deps): add asyncpg and openpyxl to requirements.txt` |
| `ci` | Thay đổi cấu hình CI/CD tự động | Không tăng version | `ci(github): add automated pytest action workflow` |
| `chore` | Tác vụ phụ trợ, bảo trì cấu hình | Không tăng version | `chore(git): update gitignore to exclude pytest cache and venv` |
| `revert` | Hoàn tác lại một commit trước đó | Tùy ngữ cảnh | `revert: revert "feat(cdms): experimental memory lock"` |

#### 2. Quy ước Scope (Phạm vi ảnh hưởng)
Scope được đặt trong dấu ngoặc đơn ngay sau Type, phản ánh chính xác module hoặc phân vùng chức năng:
- Ingestion: `(webhook)`, `(excel)`, `(polling)`
- Lõi xử lý: `(pipeline)`, `(detector)`, `(canonical)`, `(idempotency)`
- Cơ sở dữ liệu: `(db)`, `(migrations)`, `(repo)`
- Dịch vụ giả lập: `(emulator)`, `(store)`, `(seed)`
- Cấu hình hạ tầng: `(docker)`, `(config)`, `(deps)`

#### 3. Quy tắc định dạng câu mô tả (Description)
1. **Sử dụng thể mệnh lệnh hiện tại (Imperative mood):** Dùng động từ nguyên mẫu như `add`, `fix`, `implement`, `update`, `remove` (không dùng quá khứ như `added`, `fixed` hay tiếp diễn `adding`).
2. **Không viết hoa chữ cái đầu tiên:** Viết chữ thường cho ký tự đầu của description (trừ tên riêng hoặc hằng số).
3. **Không đặt dấu chấm ở cuối:** Dòng tiêu đề không kết thúc bằng dấu chấm (`.`).
4. **Giới hạn độ dài:** Dòng tiêu đề không vượt quá 72 ký tự để đảm bảo hiển thị tối ưu trên GitHub và terminal.

#### 4. Quy tắc Breaking Changes (Thay đổi phá vỡ tương thích)
- Đặt dấu chấm than `!` ngay trước dấu hai chấm: `<type>(<scope>)!: <description>`
- Hoặc ghi rõ đoạn `BREAKING CHANGE: <mô tả chi tiết>` tại phần Footer của commit.
- Ví dụ: `feat(api)!: change date format in webhook payload to strict iso8601`

#### 5. Bảng đối chiếu ví dụ chuẩn và ví dụ sai

| Commit đạt chuẩn (Do) | Commit không đạt chuẩn (Don't) | Lý do vi phạm |
|---|---|---|
| `feat(webhook): add idempotency key header validation` | `Added webhook validation` | Thiếu type/scope, dùng quá khứ `Added`. |
| `fix(polling): advance checkpoint only after batch commit` | `fix bug in polling.` | Description mơ hồ, có dấu chấm cuối dòng. |
| `test(failure): add lost response simulation test case` | `Update test` | Thiếu type chuẩn, viết hoa chữ cái đầu. |
| `docs(readme): add curl examples for excel upload api` | `docs: Cập nhật README` | Quá ngắn, không nêu rõ nội dung thay đổi. |
| `refactor(db): extract memory database into separate module` | `refactor code` | Scope trống, description không có ý nghĩa. |

### 12.3 Tiêu chí nghiệm thu trước khi tạo Pull Request (Definition of Done)
Một PR chỉ được coi là hoàn thiện khi đáp ứng đủ các điều kiện sau:
1. Toàn bộ Unit, Integration, Concurrency và Failure Tests chạy thành công 100% (`pytest`).
2. Mã nguồn tuân thủ đầy đủ chuẩn PEP 8 và có đầy đủ Type Annotations (Pydantic v2).
3. Tất cả các commit trong PR tuân thủ đúng chuẩn Conventional Commits 1.0.0.
4. Không có file nhạy cảm (`.env`, log, cache `.pytest_cache`, `.venv`) bị commit vào git.
5. Đã cập nhật tài liệu liên quan (`DESIGN.md`, `README.md` hoặc `SPEC.md`) nếu có thay đổi về schema hoặc endpoint API.

---

## 13. Bảng tổng hợp Anti-Patterns (Nên làm và Tránh làm)

| Chủ đề | Bắt buộc tuân thủ (Do) | Tuyệt đối tránh (Don't) |
|---|---|---|
| Kiểu dữ liệu | Khai báo kiểu chặt chẽ, dùng `unknown` và Zod validator khi nhận input ngoài. | Dùng `any`, dùng `as` bừa bãi để vượt qua trình kiểm tra kiểu. |
| Idempotency | Dùng unique constraint tại database và atomic write `ON CONFLICT`. | Kiểm tra tồn tại bằng `SELECT` rồi mới `INSERT` mà không có lock (dễ dính race condition). |
| Chuẩn hóa dữ liệu | Sắp xếp key JSON đệ quy trước khi tính toán mã băm SHA-256. | Dùng trực tiếp `JSON.stringify(rawObj)` vì thứ tự key trong JavaScript không đảm bảo. |
| Xử lý bất đồng bộ | Dùng `async/await` kết hợp `try/catch` có cấu trúc. | Dùng callback lồng nhau, bỏ qua rejected promise, hoặc không await kết quả. |
| Cơ sở dữ liệu | Gom các thao tác ghi dữ liệu liên quan vào cùng một Transaction ngắn gọn. | Mở transaction dài bao bọc cả các lời gọi HTTP API bên ngoài. |
| Xử lý lỗi | Chuẩn hóa mã lỗi và message, trả đúng HTTP Status Code. | Trả HTTP 200 kèm nội dung lỗi `{ error: true }`, hoặc để lộ stack trace ra ngoài. |
| Ghi nhận nhật ký | Dùng Structured JSON Logger, có gắn traceId và context rõ ràng. | Dùng `console.log()` tự do, log mật khẩu hoặc credentials nhạy cảm. |
| Cấu hình | Đọc qua biến môi trường và validate chặt chẽ lúc khởi động. | Hardcode URL, port, connection string trực tiếp trong code logic. |
