# SECURITY — Threat model, kiểm soát và kiểm thử (3-Service Architecture)

**Nguồn:** yêu cầu bảo mật 3.1 trong ảnh đề; cập nhật theo kiến trúc 3 dịch vụ (`core-service`, `payment-service`, `notification-service`). **Owner:** TV1 điều phối, mọi TV chịu trách nhiệm security module/service mình phụ trách.

## 1. Ma trận yêu cầu từ đề

| Nguy cơ | Yêu cầu | Kiểm thử minh chứng |
|---|---|---|
| JWT auth | Access token hạn **15 phút**, chữ ký bằng bí mật/khóa ≥32 byte, kiểm tra `iss`, `aud`, `exp`, chặn thuật toán yếu | sửa payload/token hết hạn/token `alg:none` → 401 |
| Refresh theft | Refresh token dài hạn trong cookie **HttpOnly, Secure, SameSite=Strict**; rotation mỗi lần refresh, revoke family nếu token dùng lại; chỉ lưu hash ở `core.refresh_sessions` | dùng refresh cũ lần 2 → 401, revoke phiên liên quan |
| RBAC + IDOR | Middleware theo vai trò và resource ownership; staff theo rạp, manager theo scope | customer gọi admin endpoint; manager rạp A sửa rạp B; guest xem đơn người khác → 403/404 |
| Injection/XSS | Query Knex parameterized, allowlist sort/filter, sanitize/validate; React escape mặc định, không chèn HTML không kiểm chứng | injection ở tên phim/inputs; XSS ở tên phim/họ tên → không thực thi |
| CSRF/CORS | API cookie endpoints cần CSRF protection; CORS origins whitelist, credentials; không `*` với cookie | form cross-site gọi `/auth/refresh` không có CSRF → 403 |
| DoS | Rate limit auth, reset, tra cứu, giữ ghế, thanh toán qua **Redis chia sẻ (D-14)**; `body` giới hạn; `pageSize ≤100` | burst login → 429 |
| Server-to-server & Webhook | `payment-service` xác minh HMAC SHA-256 của body raw bằng khóa ≥32 bytes, timestamp/replay protection, idempotency; giao tiếp nội bộ giữa `core`, `payment`, `notification` dùng **signed service JWT (D-13)** | HMAC sai → 401; webhook replay → xử lý 1 lần; service JWT sai `aud`/`scope` → 401/403 |
| Client-supplied data | DTO whitelist, `z.object(...).strict()`; không bind mass-assignment | gửi `role`, `priceVnd` → bỏ qua/reject |
| Headers/secrets | Helmet, HTTPS, HSTS, CSP phù hợp, `Cache-Control: no-store` nhạy cảm; `.env` không commit, log che password/token | audit headers; grep repo và log |

## 2. Trust Boundaries trong Kiến trúc 3 Dịch vụ

- **Browser → Public REST (`core-service :4001`, `payment-service :4002`)**: dữ liệu không tin cậy, Zod server validate, kiểm tra quyền trên từng tài nguyên.
- **Core Service ↔ Payment Service ↔ Notification Service (`/internal/*`)**: chỉ chấp nhận **signed service JWT (D-13)** với `aud` khớp tên service nhận (`core-service`, `payment-service`, `notification-service`), `scope` tối thiểu và TTL ngắn (60s).
- **Mock Payment Provider → Payment Service (`/api/v1/payments/webhook`)**: xác minh chữ ký HMAC SHA-256 trên raw payload, kiểm tra độ lệch timestamp và chống phát lại (`provider_event_id` unique).
- **Services → PostgreSQL 17 (`core`, `payment`, `notification` schemas)**: mỗi service cố định `searchPath` vào đúng schema mình sở hữu, không truy vấn bảng thuộc schema của service khác.
- **Notification Service → Mailpit/SMTP**: không log SMTP credentials hoặc liên kết chứa guest access token thô.

## 3. Điều khiển bảo mật ACCEPTED (D-08 / D-09 / D-13 / D-14 / D-18)

- **Guest token (D-08):** sinh CSPRNG đủ entropy, chỉ lưu hash trong `core.bookings`, scope theo từng booking; email đơn thuần không đủ để đọc hoặc hủy booking.
- **Webhook (D-09):** HMAC SHA-256 trên raw payload tại `payment-service`, constant-time compare, kiểm timestamp/event ID, chặn replay và xử lý idempotent.
- **Internal REST (D-13):** signed service JWT giữa `core-service`, `payment-service` và `notification-service`.
- **Rate limit (D-14):** Redis chia sẻ giữa các services/instances.
- **UTC và integer VND (D-18):** không tin timezone/số tiền do client gửi; server tính nghiệp vụ theo UTC và integer VND.
