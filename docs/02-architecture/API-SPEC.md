# API SPEC — REST conventions & hợp đồng giữa module

## 1. Quy ước bắt buộc

- Prefix `/api/v1`; `Content-Type: application/json`; OpenAPI **3.1** là nguồn hợp đồng machine-readable ở `openapi/cinema-api.yaml`.
- Thời gian API trả **ISO 8601 UTC** (`2026-12-20T12:30:00Z`), client hiển thị `Asia/Ho_Chi_Minh`; tiền integer **VND**.
- `GET` chỉ đọc, không có side effect; `POST` tạo/chuyển trạng thái, `PATCH` cập nhật một phần; `DELETE` theo policy (soft-delete/hủy).
- Pagination: `page=1`, `pageSize=20` (max 100), `meta.total` và `meta.totalPages`; filter/sort whitelist.
- API auth `Authorization: Bearer <access-token>`; refresh/logout qua HttpOnly cookie + CSRF defense; booking guest dùng scoped guest token.
- `Idempotency-Key` cho create hold/booking/payment và confirm event; server scope key theo principal/endpoint và hash request.

## 2. Envelope phản hồi [ĐỀ XUẤT]

Success:
```json
{"data":{"id":"uuid","status":"confirmed"},"meta":{"requestId":"req_123"}}
```

List:
```json
{"data":[],"meta":{"page":1,"pageSize":20,"total":0,"totalPages":0,"requestId":"req_123"}}
```

Failure:
```json
{"error":{"code":"SEAT_UNAVAILABLE","message":"Ghế vừa được người khác chọn.","details":{"seatIds":["uuid"]}},"meta":{"requestId":"req_123"}}
```

| HTTP | Ý nghĩa | Ví dụ |
|---|---|---|
| 400 | Bad Request | Body JSON malformed |
| 401 | Authentication required | JWT missing/expired |
| 403 | Authenticated but forbidden | Manager ngoài scope |
| 404 | Not found or hidden due to access | Booking không thuộc người dùng |
| 409 | Business conflict | Seat occupied, overlap, used QR |
| 410 | Expired | Hold expired |
| 422 | Validation error | Field invalid |
| 429 | Too many requests | Auth/checkout limits |
| 500 | Server failure | Không lộ stack/SQL |
| 503 | Temporary unavailable | Payment/db downstream |

## 3. Endpoint inventory

| Owner | Method | Path | Auth | Mục đích |
|---|---|---|---|---|
| TV1 | POST | `/auth/register` | Public | Đăng ký |
| TV1 | POST | `/auth/login` | Public | Đăng nhập |
| TV1 | POST | `/auth/verify-email` | Public | Kích hoạt email |
| TV1 | POST | `/auth/refresh` | Cookie+CSRF | Refresh rotation |
| TV1 | POST | `/auth/logout` | Cookie+CSRF | Revoke session |
| TV1 | GET/PATCH | `/users/me` | Customer+ | Hồ sơ cá nhân |
| TV1 | GET | `/users` | Admin | Danh sách người dùng |
| TV1 | PATCH | `/users/{id}/roles` | Admin | Phân quyền |
| TV2 | GET | `/movies` | Public | Search/filter/page |
| TV2 | GET | `/movies/{id}` | Public | Chi tiết phim |
| TV2 | POST/PATCH/DELETE | `/movies[/{id}]` | Manager/Admin scope | Quản trị phim |
| TV2 | GET/POST | `/cinemas` | Public/Admin | Rạp |
| TV2 | GET | `/cinemas/{id}/auditoriums` | Public | Phòng chiếu |
| TV2 | POST | `/auditoriums` | Manager/Admin | Tạo phòng |
| TV2 | GET | `/auditoriums/{id}/seats` | Public | Sơ đồ gốc |
| TV3 | GET/POST/PATCH | `/showtimes[/{id}]` | Public/Manager | Lịch chiếu |
| TV3 | GET | `/showtimes/{id}/seats` | Public | Ghế theo suất |
| TV3 | POST | `/seat-holds` | Guest/Customer | Giữ ghế |
| TV3 | DELETE | `/seat-holds/{id}` | Owner | Giải phóng |
| TV4 | POST | `/bookings` | Guest/Customer | Tạo đơn từ hold |
| TV4 | GET | `/bookings/me` | Customer | Lịch sử |
| TV4 | GET | `/bookings/{id}` | Owner/guest token | Chi tiết đơn |
| TV4 | POST | `/bookings/{id}/cancel` | Owner/guest token | Hủy hợp lệ |
| TV4 | GET | `/concessions` | Public | Bắp nước |
| TV4 | POST | `/payments` | Booking owner | Tạo thanh toán |
| TV4 | POST | `/payments/webhook` | HMAC | Callback provider |
| TV4 | GET | `/tickets/{id}` | Owner/guest token | Vé QR |
| TV5 | POST | `/checkins/verify` | Staff scope | Kiểm tra QR |
| TV5 | POST | `/checkins` | Staff scope | Soát vé |
| TV5 | GET | `/reports/revenue` | Manager/Admin scope | Doanh thu |
| TV5 | GET | `/reports/tickets` | Manager/Admin scope | Vé bán |
| TV5 | GET | `/reports/occupancy` | Manager/Admin scope | Tỉ lệ lấp đầy |
| All | GET | `/health/live`, `/health/ready` | Infrastructure | Healthchecks |

## 4. Các payload chuẩn cần đồng thuận trước khi code

### POST /seat-holds
Request:
```json
{"showtimeId":"8a86aa39-58da-4c58-aa9e-d6a49cb0b8d4","seatIds":["14f73523-8476-49e2-b34d-1e8c6f8cf19f"]}
```
Header `Idempotency-Key: <uuid-v4>`. Response 201:
```json
{"data":{"id":"uuid","showtimeId":"uuid","seatIds":["uuid"],"expiresAt":"2026-12-20T12:25:00Z","totalVnd":95000},"meta":{"requestId":"req-1"}}
```

### POST /bookings
Request:
```json
{"holdGroupId":"uuid","contact":{"fullName":"Nguyễn Văn A","email":"example@example.com","phone":"0900000000"},"concessions":[{"concessionId":"uuid","quantity":2}]}
```
Response 201 returns `bookingId`, `status=pending_payment`, `totalVnd`, `expiresAt`. Server verifies hold and recalculates total.

### POST /payments
Request `{ "bookingId": "uuid", "method": "mock" }`; response `paymentId`, `paymentUrl` or mock payment action; no success is granted from this response alone.

### POST /checkins
Request `{ "qrCode": "opaque-code", "showtimeId": "uuid" }`; server checks staff scope, QR validity, seat/ticket state and uniqueness, then returns receipt.

## 5. Internal API contracts [ĐỀ XUẤT]

| Caller → Owner | Route nội bộ | Hành động |
|---|---|---|
| Booking → Showtime | `POST /internal/seat-holds/{id}/verify` | Kiểm tra hold owner/TTL và server quote |
| Booking → Showtime | `POST /internal/seat-holds/{id}/confirm` | Confirm allocation idempotent |
| Booking → Showtime | `POST /internal/seat-allocations/{id}/release` | Hủy allocation theo policy |
| Operations → Booking | `POST /internal/tickets/verify` | Verify signed QR + trạng thái vé |
| Showtime → Catalog | `GET /internal/auditoriums/{id}/seat-map` | Kiểm tra sơ đồ/phòng |

Internal route phải có service-to-service authentication (signed service JWT (đã chốt D-13)) và timeout; không expose công khai qua gateway.

## 6. OpenAPI governance

- `openapi/cinema-api.yaml` trong gói là **contract v3**, bao phủ danh mục public endpoints dự kiến và internal operations trong `openapi/internal-api.yaml`; vẫn phải rà soát cùng implementation, request/response và edge cases. Khi code, mỗi owner phải cập nhật OpenAPI cho **mọi endpoint thực tế**, request/response, error và security scheme; không tự tuyên bố đã đủ 100%.
- Lint schema trong CI; UI Swagger (`/api-docs`) cần hiển thị spec thành công.
- Thay đổi breaking contract cần PR ghi tác động và xác nhận owner của bên gọi.
- Tách API contract public vs internal, có thể lưu `openapi/internal/*.yaml` khi phát triển.


## API contract các quyết định ACCEPTED — 2026-11-18

| Contract | Quy tắc | HTTP phản hồi quan trọng |
|---|---|---|
| `POST /seat-holds` | `seatIds` 1–8 (đếm ghế vật lý), ghế đôi phải gồm 2 ID, `expiresAt` = server now + 300 giây | 201, 409 bị giữ/bán, 422 thiếu cặp |
| `POST /bookings` | Guest email + scoped guest access token, hold còn hiệu lực; tiền integer VND | 201, 403/409/410 |
| `POST /bookings/{id}/cancel` | `startsAt - now >= 120 phút`, chưa check-in; mock refund, không hủy ghế đôi riêng | 200, 403/409 |
| `POST /payments/webhook` | HMAC(raw body), timestamp, event id/idempotency, chỉ confirmed sau Showtime allocation | 200, 401, 409 |
| `POST /checkins` | `startsAt-30m <= now <= startsAt+30m`, chỉ 1 check-in/ticket | 200/201, 403/409 |
| `POST /showtimes` | Không overlap cùng phòng, buffer 15 phút sau suất | 201, 409 |
| `/internal/*` | Bearer signed service JWT, verify audience/issuer/scopes/exp | 401/403 |

**Thống nhất:** số tiền là integer VND, timestamp ISO 8601 UTC (`Z`), hiển thị theo Asia/Ho_Chi_Minh. Redis là bộ đếm rate-limit chung. `openapi/cinema-api.yaml` là hợp đồng ban đầu, vẫn cần hoàn thiện operation chi tiết khi code.


## Bổ sung bản v3
- Xem `CONTRACT-MATRIX.md` để triển khai contract giao tiếp giữa 5 service.
- Public API: `openapi/cinema-api.yaml`; internal service API: `openapi/internal-api.yaml`.
- Mọi endpoint cần có contract tests khi code; tài liệu này chưa chứng minh endpoint đang hoạt động.
