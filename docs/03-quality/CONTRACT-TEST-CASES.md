# Contract & Concurrency Test Cases (3-Service Architecture)

> Test plan cho các tính năng nghiệp vụ; phân theo chủ sở hữu module (`TV1`–`TV5`) và 3 dịch vụ (`core-service`, `payment-service`, `notification-service`).

| ID | Owner & Service | Scenario | Expected | Priority |
|---|---|---|---|---|
| CT-01 | TV3 (`core-service`) | 20 `POST /api/v1/seat-holds` đồng thời cùng ghế (keys khác) | Chính xác 1 hold `active` trong `core.seat_holds` | P0 |
| CT-02 | TV3 (`core-service`) | 20 holds đồng thời vào một ghế đôi (`couple_pair_id`) | Chính xác một cặp được giữ nguyên tử, không có nửa cặp | P0 |
| CT-03 | TV3 (`core-service`) | Request chỉ 1 seat của couple pair | `422`, không tạo hold | P0 |
| CT-04 | TV3 (`core-service`) | 9 `seatIds` hoặc trùng ID | `422` (tối đa 8 ghế vật lý theo D-06) | P0 |
| CT-05 | TV3 (`core-service`) | Hold sau 300s (server clock) | `410`/expired; ghế mở bán lại được | P0 |
| CT-06 | TV3/TV4 (`core-service` ↔ `payment-service`) | 2 lần gửi `payment-result` cùng `idempotencyKey` | Một `seat_allocation` mỗi ghế, một bộ vé duy nhất | P0 |
| CT-07 | TV4 (`payment-service`) | Webhook cùng `eventId` gửi 5 lần | Một payment outcome tại `payment.payment_events` và một bộ vé | P0 |
| CT-08 | TV4 (`payment-service` ↔ `core-service`) | Payment success đến sau khi hold hết hạn | Không cấp vé; `refund_pending -> refunded` tại Payment Service | P0 |
| CT-09 | TV4 (`core-service`) | Cancel khi còn 119 phút trước `starts_at` | `409`, không hoàn tiền | P0 |
| CT-10 | TV4 (`core-service` ↔ `payment-service`) | Cancel khi còn ≥120 phút, chưa check-in | Chấp nhận, giải phóng ghế tại `core`, mock refund tại `payment` | P0 |
| CT-11 | TV5 (`core-service`) | Check-in tại `T-31m / T-30m / T+30m / T+31m` | Reject / accept / accept / reject (D-10) | P0 |
| CT-12 | TV5 (`core-service`) | 2 check-in đồng thời cùng ticket | Chỉ 1 thành công, `UNIQUE(ticket_id)` tại `core.ticket_checkins` | P0 |
| CT-13 | TV3 (`core-service`) | Buffer 14m59s vs 15m giữa hai suất cùng phòng | `409` vs `201` (D-11) | P1 |
| CT-14 | TV1 (All 3 Services) | Customer JWT gọi `/internal/*` trên Core/Payment/Notification | `401`/`403` (D-13) | P0 |
| CT-15 | TV1 (All 3 Services) | Service JWT sai `aud`/expired/sai `scope` | `401`/`403` | P0 |
| CT-16 | TV1 (`core-service` & `payment-service`) | Rate-limit requests qua nhiều instances | Dùng chung bộ đếm Redis / trả `429` (D-14) | P1 |
| CT-17 | TV4 (`core-service`) | Guest token xem booking của người khác | `403`/`404`; không lộ dữ liệu (D-08) | P0 |
| CT-18 | All (`core`, `payment`, `notification`) | DB role của `payment-service` truy vấn bảng `core.*` | Permission denied (ranh giới schema D-04) | P0 |
| CT-19 | All (`core-service`) | Seed lịch chiếu `20/12/2026 19:30 Asia/Ho_Chi_Minh` | Lưu UTC đúng `2026-12-20T12:30:00Z` (D-16, D-18) | P1 |
| CT-20 | TV4/TV5 (`core-service`) | Cancel và check-in gần đồng thời trên cùng booking/ticket | Không xảy ra trạng thái vừa `cancelled` vừa `used` | P0 |
| CT-21 | TV4 (`payment-service`) | Sai HMAC, timestamp lệch, altered raw body | `401`, không thay đổi dữ liệu (D-09) | P0 |
| CT-22 | TV5 (`notification-service`) | Notification Service lỗi tạm thời sau khi booking đã `confirmed` | Booking và vé QR vẫn giữ trạng thái `confirmed`; ghi nhận retry | P0 |

## Kiểm thử contract tự động

- OpenAPI 3.1 validate parse và unique `operationId` cho cả `openapi/cinema-api.yaml` và `openapi/internal-api.yaml`.
- Internal API giữa `core-service`, `payment-service`, `notification-service` verify `aud`, `iss`, `scope` bằng signed service JWT.
- Coverage mục tiêu theo đề ≥60% tại `backend/` (`services/api` theo đề); latency list <200ms, seat <100ms **chỉ được công bố sau khi đo**.
