# Contract Matrix — public & internal boundary (v3)

## 1. Ownership và data contracts

| Module | Public path prefix | DB schema | Internal called by | Core invariant |
|---|---|---|---|---|
| Identity (TV1) | `/auth`, `/users` | `identity` | Tất cả verify JWT/JWKS | Role & cinema scope verified server-side |
| Catalog (TV2) | `/movies`, `/cinemas`, `/auditoriums` | `catalog` | Showtime seat-map lookup | Ghế đôi đúng 2 seat IDs |
| Showtime (TV3) | `/showtimes`, `/seat-holds` | `showtime` | Booking verify/confirm/release hold | No double hold/sell |
| Booking (TV4) | `/bookings`, `/payments`, `/tickets`, `/concessions` | `booking` | Operations verify ticket | Only paid & allocated booking issues QR |
| Operations (TV5) | `/checkins`, `/reports` | `operations` | Booking/report read models | Check-in at most once |

## 2. Required internal contract

| Caller | Endpoint | Request required | Response | Retry |
|---|---|---|---|---|
| Booking → Showtime | `POST /internal/seat-holds/{id}/verify` | bookingId, ownerRef | holdId, expiresAt, serverQuoteVnd, seatIds | Safe read/validation |
| Booking → Showtime | `POST /internal/seat-holds/{id}/confirm` | bookingId, idempotencyKey | allocationIds, status confirmed | Must be idempotent |
| Booking → Showtime | `POST /internal/seat-allocations/release` | bookingId, reason, idempotencyKey | released seatIds | Must be idempotent |
| Showtime → Catalog | `GET /internal/auditoriums/{id}/seat-map` | auditoriumId | seats + couplePairId + version | Read safe |
| Operations → Booking | `POST /internal/tickets/verify` | qrToken, showtimeId | ticketId, bookingId, ticketStatus, seatId | Read safe; protect QR |
| Operations → Booking | `POST /internal/reports/booking-summary` | cinemaId/from/to | metrics | Read safe |

## 3. Signed service JWT

- Claims `iss`, `sub`, `aud`, `iat`, `exp`, `jti`, `scope`; `aud` bắt buộc là service đích.
- Mỗi endpoint giới hạn quyền (ví dụ `seat-hold:confirm`, `ticket:verify`).
- Token thời gian ngắn (đề xuất 60 giây), ký RS256/ES256 với private key được giữ tại issuer, service chỉ có public key.
- Không truyền service JWT tới browser; không chấp nhận customer JWT thay cho service JWT.
- `x-request-id` và `Idempotency-Key` được forward/normalize giữa services, không log raw token.

## 4. End-to-end exceptions

| Điều kiện | API bên ngoài | Internal action | Kết quả cuối |
|---|---|---|---|
| Hold expired | `POST /bookings` → 410 | Showtime verify rejects | Không tạo booking mới |
| Seat busy | `POST /seat-holds` → 409 | Transaction rejects | Không lấy ghế |
| Couple pair thiếu | `POST /seat-holds` → 422 | Catalog seat map + Showtime validation | Chọn đủ hai ghế |
| Webhook replay | `/payments/webhook` → 200 | eventId dedup | Không phát hành vé lần hai |
| Payment success after expired hold | Webhook ack 200 after durable receipt | Showtime confirm rejects; enqueue refund | Không cấp vé, refund_pending |
| Check-in too early/late | `/checkins` → 409 | Verify showtime time window | Không check-in |
| Booking cancel <120m | `/bookings/{id}/cancel` → 409 | No release or refund | Giữ booking |
| Used ticket check-in again | `/checkins` → 409 | Unique(ticketId) | Không check-in lần 2 |

## 5. Definition of Done cho API contract

- `openapi/cinema-api.yaml` (public), `openapi/internal-api.yaml` (internal) được parse thành công.
- Mọi operation có method/path/operationId/responses, security rõ; write operations có request body/schema.
- Owner cập nhật mock response, validation và tests; PR thay breaking schema cần reviewer của caller và callee.
- Contract chỉ là **đặc tả**; không chứng minh endpoint đã tồn tại.
