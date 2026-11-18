# Contract & Concurrency Test Cases v3

> Test plan, **chưa chạy**. Phân theo chủ module và service liên quan.

| ID | Module | Scenario | Expected | Priority |
|---|---|---|---|---|
| CT-01 | TV3 | 20 POST holds đồng thời cùng ghế (keys khác) | Chính xác 1 hold ACTIVE | P0 |
| CT-02 | TV3 | 20 holds đồng thời vào một ghế đôi | Chính xác một cặp được giữ, không có nửa cặp | P0 |
| CT-03 | TV3 | Request chỉ 1 seat của couple pair | 422, không có hold | P0 |
| CT-04 | TV3 | 9 seatIds hoặc trùng ID | 422 | P0 |
| CT-05 | TV3 | Hold sau 300s, clock server điều khiển | 410/expired; ghế bán lại được | P0 |
| CT-06 | TV3/TV4 | 2 confirm cùng hold/idempotency key | Một allocation mỗi seat, kết quả giống nhau | P0 |
| CT-07 | TV4 | Webhook cùng eventId gửi 5 lần | Một payment outcome và một bộ vé | P0 |
| CT-08 | TV4 | Payment success sau expired hold | Không vé; refund_pending→refunded | P0 |
| CT-09 | TV4 | Cancel khi còn 119 phút | 409, không refund | P0 |
| CT-10 | TV4 | Cancel khi còn đúng 120 phút, chưa check-in | Chấp nhận, mock refund | P0 |
| CT-11 | TV5 | Check-in T-31m / T-30m / T+30m / T+31m | Reject / accept / accept / reject | P0 |
| CT-12 | TV5 | 2 checkin đồng thời cùng ticket | Chỉ 1 success, unique ticket_id | P0 |
| CT-13 | TV3 | Buffer 14m59s vs 15m giữa hai suất | 409 vs 201 | P1 |
| CT-14 | TV1 | Customer token gọi internal confirm | 401/403 | P0 |
| CT-15 | TV1 | Service JWT sai audience/expired/scope | 401/403 | P0 |
| CT-16 | TV1 | Rate-limit requests qua 2 API instances | Redis cho cùng counter / 429 | P1 |
| CT-17 | TV4 | Guest token xem booking người khác | 403/404; không lộ dữ liệu | P0 |
| CT-18 | All | DB role schema A đọc bảng schema B | Permission denied | P0 |
| CT-19 | All | Seed lịch 20/12/2026 19:30 Asia/Ho_Chi_Minh | UTC đúng 2026-12-20T12:30:00Z | P1 |
| CT-20 | TV4/TV5 | Cancel và check-in gần đồng thời | Không có trạng thái cả cancelled và used | P0 |
| CT-21 | TV4 | Sai HMAC, timestamp lệch, altered raw body | 401, không mutation | P0 |
| CT-22 | TV2/TV3 | Ghế đôi thiếu/3 seat trong một pair | Rejected before publish/hold | P0 |

## Kiểm thử contract tự động

- OpenAPI 3.1 validate parse và unique operationId. Test mỗi response thật phù hợp schema trong `openapi/cinema-api.yaml`.
- Internal API verify `aud`, `iss`, `scope` bằng signed JWT; test caller thiếu quyền.
- DB migration/constraints phải chạy trên PostgreSQL test thật, không chỉ mock repository.
- Coverage mục tiêu theo đề ≥60% tại `services/api`; latency list <200ms, seat <100ms **chỉ được công bố sau khi đo**.
