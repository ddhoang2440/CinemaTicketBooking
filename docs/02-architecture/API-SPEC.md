# API SPEC — REST conventions & hợp đồng giữa 3 dịch vụ (`core`, `payment`, `notification`)

## 1. Quy ước bắt buộc

- Public API prefix: `/api/v1`; `Content-Type: application/json`; OpenAPI **3.1** là nguồn hợp đồng machine-readable ở `openapi/cinema-api.yaml` (public) và `openapi/internal-api.yaml` (internal).
- Thời gian API trả **ISO 8601 UTC** (`2026-12-20T12:30:00Z`), client hiển thị `Asia/Ho_Chi_Minh`; tiền integer **VND** (D-18).
- `GET` chỉ đọc, không có side effect; `POST` tạo/chuyển trạng thái, `PATCH` cập nhật một phần; `DELETE` theo policy (soft-delete/hủy).
- Pagination: `page=1`, `pageSize=20` (max 100), `meta.total` và `meta.totalPages`; filter/sort whitelist.
- API auth `Authorization: Bearer <access-token>`; refresh/logout qua HttpOnly cookie + CSRF defense; booking guest dùng scoped guest token (`X-Guest-Booking-Token`, D-08).
- `Idempotency-Key` cho create hold/booking/payment/refund/notification và confirm event.

## 2. Envelope phản hồi chuẩn

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
| 401 | Authentication required | JWT missing/expired, invalid HMAC |
| 403 | Authenticated but forbidden | Manager ngoài scope |
| 404 | Not found or hidden due to access | Booking không thuộc người dùng |
| 409 | Business conflict | Seat occupied, overlap, used QR, cancel <120m |
| 410 | Expired | Hold expired |
| 422 | Validation error | Field invalid, incomplete couple seat pair |
| 429 | Too many requests | Shared Redis rate limit exceeded |
| 500 | Server failure | Không lộ stack/SQL |
| 503 | Temporary unavailable | Downstream service unavailable |

## 3. Public Endpoint Inventory (Phân theo Service & Module Owner)

| Service | Module Owner | Method | Path (`/api/v1/*`) | Auth | Mục đích |
|---|---|---|---|---|---|
| `core-service` (`:4001`) | TV1 | POST | `/auth/register` | Public | Đăng ký |
| `core-service` (`:4001`) | TV1 | POST | `/auth/login` | Public | Đăng nhập |
| `core-service` (`:4001`) | TV1 | POST | `/auth/verify-email` | Public | Kích hoạt email |
| `core-service` (`:4001`) | TV1 | POST | `/auth/refresh` | Cookie+CSRF | Refresh rotation |
| `core-service` (`:4001`) | TV1 | POST | `/auth/logout` | Cookie+CSRF | Revoke session |
| `core-service` (`:4001`) | TV1 | GET/PATCH | `/users/me` | Customer+ | Hồ sơ cá nhân |
| `core-service` (`:4001`) | TV1 | GET | `/users` | Admin | Danh sách người dùng |
| `core-service` (`:4001`) | TV1 | PATCH | `/users/{id}/roles` | Admin | Phân quyền |
| `core-service` (`:4001`) | TV2 | GET | `/movies` | Public | Search/filter/page |
| `core-service` (`:4001`) | TV2 | GET | `/movies/{id}` | Public | Chi tiết phim |
| `core-service` (`:4001`) | TV2 | POST/PATCH/DELETE | `/movies[/{id}]` | Manager/Admin | Quản trị phim |
| `core-service` (`:4001`) | TV2 | GET/POST | `/cinemas` | Public/Admin | Cụm rạp |
| `core-service` (`:4001`) | TV2 | GET | `/cinemas/{id}/auditoriums` | Public | Phòng chiếu |
| `core-service` (`:4001`) | TV2 | POST | `/auditoriums` | Manager/Admin | Tạo phòng chiếu |
| `core-service` (`:4001`) | TV2 | GET | `/auditoriums/{id}/seats` | Public | Sơ đồ ghế gốc + `couplePairId` |
| `core-service` (`:4001`) | TV3 | GET/POST/PATCH | `/showtimes[/{id}]` | Public/Manager | Lịch chiếu (buffer 15p D-11) |
| `core-service` (`:4001`) | TV3 | GET | `/showtimes/{id}/seats` | Public | Trạng thái ghế theo suất |
| `core-service` (`:4001`) | TV3 | POST | `/seat-holds` | Guest/Customer | Giữ ghế nguyên tử (TTL 300s D-05) |
| `core-service` (`:4001`) | TV3 | DELETE | `/seat-holds/{id}` | Owner | Giải phóng ghế đang giữ |
| `core-service` (`:4001`) | TV4 | POST | `/bookings` | Guest/Customer | Tạo đơn từ hold (tối đa 8 ghế D-06) |
| `core-service` (`:4001`) | TV4 | GET | `/bookings/me` | Customer | Lịch sử đặt vé |
| `core-service` (`:4001`) | TV4 | GET | `/bookings/{id}` | Owner/guest token | Chi tiết đơn |
| `core-service` (`:4001`) | TV4 | POST | `/bookings/{id}/cancel` | Owner/guest token | Hủy hợp lệ (≥120p, chưa check-in D-07) |
| `core-service` (`:4001`) | TV4 | GET | `/concessions` | Public | Danh sách bắp nước |
| `core-service` (`:4001`) | TV4 | GET | `/tickets/{id}` | Owner/guest token | Vé điện tử QR |
| `core-service` (`:4001`) | TV5 | POST | `/checkins/verify` | Staff scope | Kiểm tra QR |
| `core-service` (`:4001`) | TV5 | POST | `/checkins` | Staff scope | Soát vé ([-30,+30]p D-10) |
| `core-service` (`:4001`) | TV5 | GET | `/reports/{revenue,tickets,occupancy}` | Manager/Admin | Báo cáo thống kê |
| `payment-service` (`:4002`) | TV4 | POST | `/payments` | Booking owner | Khởi tạo thanh toán giả lập |
| `payment-service` (`:4002`) | TV4 | GET | `/payments/{id}` | Booking owner | Truy vấn trạng thái thanh toán |
| `payment-service` (`:4002`) | TV4 | POST | `/payments/webhook` | HMAC (`x-payment-signature`) | Callback từ mock payment provider (D-09) |
| All 3 Services | All | GET | `/health`, `/health/live`, `/health/ready` | Infrastructure | Healthchecks |

## 4. Internal Service-to-Service API Contracts (`openapi/internal-api.yaml`)

Mọi lời gọi `/internal/*` giữa `core-service`, `payment-service` và `notification-service` bắt buộc sử dụng **signed service JWT (D-13)** với `iss`, `aud`, `exp`, `scope`, kèm `x-request-id` và `Idempotency-Key`.

| Caller → Callee | Route nội bộ | Hành động |
|---|---|---|
| Core → Payment | `POST /internal/payments/intents` | Khởi tạo giao dịch thanh toán cho booking đã kiểm tra hold |
| Core → Payment | `GET /internal/payments/{paymentId}` | Truy vấn trạng thái thanh toán xác thực từ Payment Service |
| Core → Payment | `POST /internal/payments/{paymentId}/refund` | Yêu cầu hoàn tiền giả lập (khi khách hủy hợp lệ hoặc compensation do hold hết hạn) |
| Payment → Core | `POST /internal/bookings/{bookingId}/payment-result` | Thông báo kết quả thanh toán đã xác minh HMAC để Core xác nhận phân bổ ghế và cấp vé QR |
| Core → Notification | `POST /internal/notifications/send` | Yêu cầu gửi email (xác nhận vé + QR, xác nhận đăng ký, hoặc thông báo hủy/hoàn tiền) |
| Payment → Notification | `POST /internal/notifications/send` | Yêu cầu gửi thông báo biên lai/hoàn tiền (nếu cần) |
