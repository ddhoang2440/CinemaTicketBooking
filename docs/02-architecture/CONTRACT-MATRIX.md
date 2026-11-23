# Contract Matrix — Public & Internal Boundaries (3-Service Architecture)

## 1. Service Ownership & Database Schemas (`D-04 ACCEPTED — REVISED`)

| Service | Port | DB Schema | Modules & Owners | Public Path Prefix | Core Invariant |
|---|---:|---|---|---|---|
| **Core Service** (`core-service`) | `4001` | `core` | `auth`, `users`, `roles` (TV1); `movies`, `cinemas`, `auditoriums`, `seats` (TV2); `showtimes`, `pricing`, `seat-holds` (TV3); `bookings`, `concessions`, `tickets` (TV4); `checkins`, `reports` (TV5) | `/api/v1/auth`, `/api/v1/users`, `/api/v1/movies`, `/api/v1/cinemas`, `/api/v1/auditoriums`, `/api/v1/showtimes`, `/api/v1/seat-holds`, `/api/v1/bookings`, `/api/v1/concessions`, `/api/v1/tickets`, `/api/v1/checkins`, `/api/v1/reports` | Authoritative seat hold/allocation; no double hold/sell; couple pair = 2 seats; only paid & allocated booking issues QR; check-in at most once |
| **Payment Service** (`payment-service`) | `4002` | `payment` | `payments`, `webhooks`, `refunds` (TV4) | `/api/v1/payments`, `/api/v1/payments/webhook` | HMAC raw-body verification, replay protection, event idempotency, mock refund consistency |
| **Notification Service** (`notification-service`) | `4003` | `notification` | `email`, `templates`, `delivery` (TV5) | *(Internal only, plus `/health`)* | Idempotent delivery tracking; notification failure never invalidates a confirmed booking |

## 2. Required Internal Service-to-Service Contracts (`openapi/internal-api.yaml`)

| Caller | Callee | Endpoint | Required Payload / Params | Response | Retry & Idempotency |
|---|---|---|---|---|---|
| Core Service | Payment Service | `POST /internal/payments/intents` | `bookingId`, `amountVnd`, `idempotencyKey` | `paymentId`, `status: initiated`, `paymentUrl` | Idempotent by `idempotencyKey` |
| Core Service | Payment Service | `GET /internal/payments/{paymentId}` | `paymentId` | `paymentId`, `bookingId`, `status`, `amountVnd` | Safe read |
| Core Service | Payment Service | `POST /internal/payments/{paymentId}/refund` | `bookingId`, `amountVnd`, `reason`, `idempotencyKey` | `refundId`, `status: refunded` | Idempotent by `idempotencyKey` |
| Payment Service | Core Service | `POST /internal/bookings/{bookingId}/payment-result` | `paymentId`, `eventId`, `status` (`succeeded`/`failed`), `amountVnd`, `idempotencyKey` | `bookingId`, `bookingStatus` (`confirmed`/`refund_pending`/`payment_failed`) | Must be idempotent |
| Core / Payment | Notification Service | `POST /internal/notifications/send` | `templateCode`, `recipientEmail`, `bookingId`, `payload`, `idempotencyKey` | `deliveryId`, `status` (`queued`/`sent`) | Safe retry; non-blocking to booking confirmation |

## 3. Signed Service JWT (D-13)

- Claims: `iss`, `sub` (`core-service` | `payment-service` | `notification-service`), `aud`, `iat`, `exp`, `jti`, `scope`; `aud` bắt buộc là tên service đích.
- Mỗi endpoint nội bộ kiểm tra scope tối thiểu (ví dụ `payment:create`, `payment:refund`, `booking:payment-result`, `notifications:send`).
- Token có thời gian sống ngắn (60 giây), không bao giờ trả về trình duyệt và không chấp nhận customer JWT thay cho service JWT.
- `x-request-id` và `Idempotency-Key` được chuyển tiếp xuyên suốt giữa 3 services.

## 4. End-to-End Exception Matrix

| Điều kiện | API bên ngoài | Hành động nội bộ giữa 3 dịch vụ | Kết quả cuối |
|---|---|---|---|
| Hold expired | `POST /api/v1/bookings` → `410` | Core kiểm tra `core.seat_hold_groups` hết hạn | Không tạo booking mới |
| Seat busy | `POST /api/v1/seat-holds` → `409` | Transaction tại `core-service` từ chối | Không giữ trùng ghế |
| Couple pair thiếu | `POST /api/v1/seat-holds` → `422` | Core kiểm tra `core.seats.couple_pair_id` | Bắt buộc chọn đủ 2 ghế đôi |
| Webhook replay | `POST /api/v1/payments/webhook` → `200` | Payment Service dedup theo `provider_event_id` | Không gọi xác nhận vé lần hai |
| Payment success sau khi hold hết hạn | Webhook ack `200` | Payment báo Core → Core phát hiện hold hết hạn → Core gọi `POST /internal/payments/{id}/refund` → gọi Notification | Không cấp vé; hoàn tiền giả lập (`refunded`) |
| Notification Service tạm ngừng | Booking đã `confirmed` | Core ghi nhận lỗi gửi thông báo để retry sau | Booking và vé QR của khách vẫn hợp lệ |
| Check-in quá sớm/muộn | `POST /api/v1/checkins` → `409` | Core kiểm tra cửa sổ `[-30m, +30m]` quanh `starts_at` | Từ chối check-in |
| Hủy đơn `< 120m` hoặc đã check-in | `POST /api/v1/bookings/{id}/cancel` → `409` | Core từ chối ngay trong transaction, không gọi Payment refund | Giữ nguyên booking |
| Quét lại vé đã check-in | `POST /api/v1/checkins` → `409` | `UNIQUE(ticket_id)` trong `core.ticket_checkins` | Không check-in lần 2 |
