# SECURITY — Threat model, kiểm soát và kiểm thử

**Nguồn:** yêu cầu bảo mật 3.1 trong ảnh đề; bổ sung chi tiết triển khai là [ĐỀ XUẤT]. **Owner:** TV1 điều phối, mọi TV chịu trách nhiệm security module mình.

## 1. Ma trận yêu cầu từ đề

| Nguy cơ | Yêu cầu | Kiểm thử minh chứng |
|---|---|---|
| JWT auth | Access token hạn **15 phút**, chữ ký bằng bí mật ≥32 byte, kiểm tra `iss`, `aud`, `exp`, chặn thuật toán yếu | sửa payload/token hết hạn/token `alg:none` → 401 |
| Refresh theft | Refresh token dài hạn trong cookie **HttpOnly, Secure, SameSite=Strict**; rotation mỗi lần refresh, revoke family nếu token dùng lại; không lưu token plaintext | dùng refresh cũ lần 2 → 401, revoke phiên liên quan |
| RBAC + IDOR | Middleware theo vai trò và resource ownership; staff theo rạp, manager theo scope | customer gọi admin endpoint; manager rạp A sửa rạp B; guest xem đơn người khác → 403/404 |
| Injection/XSS | Query Knex parameterized, allowlist sort/filter, sanitize/validate; React escape mặc định, không chèn HTML không kiểm chứng | injection ở tên phim/inputs; XSS ở tên phim/họ tên → không thực thi |
| CSRF/CORS | API cookie endpoints cần CSRF protection; CORS origins whitelist, credentials; không `*` với cookie | form cross-site gọi `/auth/refresh` không có CSRF → 403 |
| DoS | Rate limit auth, reset, tra cứu, giữ ghế qua Redis chia sẻ; `body` giới hạn; `pageSize ≤100`; statement_timeout PostgreSQL; external services timeout | burst login → 429; query quá dài/timeout không treo |
| Server-to-server | webhook phải xác minh HMAC của body raw bằng khóa ≥32 bytes, timestamp/replay protection, idempotency; service internal auth | HMAC sai → 401; webhook replay → xử lý 1 lần |
| Client-supplied data | DTO whitelist, `z.object(...).strict()` hoặc tương đương; không bind mass-assignment | gửi `role`, `priceVnd` → bỏ qua/reject |
| Headers/secrets | Helmet, HTTPS, HSTS, CSP phù hợp, `Cache-Control: no-store` nhạy cảm; `.env` không commit, log che password/token | audit headers; grep repo và log |

## 2. Luồng access/refresh đề xuất

1. Login thành công: backend phát JWT access 15 phút với `sub`, `sid`, `iss`, `aud`, `iat`, `exp`, vai trò/scopes cần thiết; refresh random 256-bit, hash trong DB, Set-Cookie HttpOnly/Secure/SameSite=Strict.
2. Refresh: client gửi cookie + CSRF header, backend kiểm rotation chain → revoke token cũ → tạo token mới; nếu phát hiện reuse, revoke toàn phiên/chuỗi gia đình tùy thiết kế.
3. Logout: revoke refresh session và clear cookie; access token ngắn hạn vẫn có thể còn hiệu lực tới hết hạn, trừ khi backend kiểm `sid` revoked trên tài nguyên nhạy cảm.
4. Dùng asymmetric signing (`RS256`/`ES256`) với verification key cho các services là [ĐỀ XUẤT]. **Không** nhận thuật toán JWT do token tự quyết định.

**Lưu ý:** `SameSite=Strict` có thể gây khó cho flow điều hướng từ site thanh toán; mock payment nên trả qua app và trạng thái từ backend; nếu production cross-site cần đánh giá lại cookie/csrf một cách có chủ đích.

## 3. Các trust boundaries

- Browser → public REST: dữ liệu không tin cậy, Zod server validate, auth per resource.
- API → DB: Knex binding, least privilege, migration role tách application role.
- Booking → Showtime: internal credentials, timeout, idempotency.
- Payment provider → webhook: raw-body HMAC, timestamp + event ID, chống replay.
- Staff scanner → Check-in: QR là bearer credential nhưng không đủ nếu staff thiếu quyền.
- App → Mailpit/email: không log SMTP credential hay nội dung chứa token; demo chỉ dùng Mailpit.

## 4. Phân quyền mẫu

| Action | Guest | Customer | Staff | Manager | Admin |
|---|---|---|---|---|---|
| Public catalog/showtimes | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hold & booking | ✓ (guest session) | ✓ | theo tài khoản customer nếu có | theo tài khoản customer nếu có | theo tài khoản customer nếu có |
| View own bookings | qua guest token | ✓ | chỉ phần kiểm vé được phân công | theo scope rạp | theo mục đích quản trị |
| Check-in | – | – | theo scope | theo scope nếu được cấp | ✓ |
| Create showtime/price | – | – | – | theo scope | ✓ |
| Manage cinema/roles | – | – | – | giới hạn theo scope | ✓ |
| Reports | – | – | – | theo scope | ✓ |

## 5. Bảo vệ ứng dụng và dữ liệu

- Phân tách domain error có mã máy (`AUTH_INVALID`, `FORBIDDEN`, `SEAT_UNAVAILABLE`), không trả SQL/stack cho client.
- Cookie auth có `Path` phù hợp, prefix `__Host-` khi thỏa điều kiện; `Cache-Control: no-store` cho phản hồi chứa PII.
- CORS origins explicit theo env; trên production bắt HTTPS.
- Rate limits tách key account/IP/user và endpoint. Giá trị ngưỡng tùy tải và hạ tầng, được config và test.
- XSS: không dùng `dangerouslySetInnerHTML` với dữ liệu thô; CSP theo static assets cần thiết.
- Mỗi secrets ở env/deploy secret manager; `.env.example` chỉ để placeholder.
- Log `requestId`, event type, actorId, status; tuyệt đối không log raw bearer, refresh cookie, password, guest token hay toàn bộ QR.

## 6. Kịch bản kiểm thử bảo mật bắt buộc

| ID | Steps | Kết quả |
|---|---|---|
| SEC-01 | Đổi payload access JWT không ký lại | 401 |
| SEC-02 | Token có `alg:none` | 401 |
| SEC-03 | Access hết 15 phút | 401 |
| SEC-04 | Dùng lại refresh token đã rotation | 401 + session family bị revoke |
| SEC-05 | Login sai liên tục | 429 (threshold cấu hình) |
| SEC-06 | Guest lấy booking ID người khác | 403/404 |
| SEC-07 | Manager rạp A PATCH suất rạp B | 403 |
| SEC-08 | Gửi SQL injection query title/filter/sort | Không thể thực thi SQL ngoài ý muốn |
| SEC-09 | Lưu tên phim chứa `<script>` | UI hiển thị an toàn; script không chạy |
| SEC-10 | Cross-site POST `/auth/refresh` thiếu token CSRF | 403 |
| SEC-11 | Webhook sai HMAC | 401 |
| SEC-12 | Replay webhook event ID | 200 idempotent/không tác dụng lặp |
| SEC-13 | `pageSize=10000` hoặc body quá lớn | 400/422/413 |
| SEC-14 | Check audit logs/repo | Không lộ secret/token |
| SEC-15 | API sensitive response | Có `no-store`, security headers phù hợp |

## 7. Tiêu chuẩn chấp nhận

Security checklist có kết quả `PASS/FAIL`, link test/PR và log bằng chứng. Các khoản chưa test phải ghi `NOT TESTED`; không được đánh dấu đạt chỉ vì đã viết trong tài liệu.


## Điều khiển bảo mật ACCEPTED (D-08/D-09/D-13/D-14)

- **Guest token:** sinh CSPRNG đủ entropy, chỉ lưu hash, scope theo booking; không tiết lộ qua logs, query phân tích, referer; email không đủ để đọc booking.
- **Webhook:** HMAC SHA-256 trên raw payload, constant-time compare, kiểm timestamp/event ID, chặn replay và xử lý idempotent.
- **Internal REST:** signed service JWT với audience riêng cho từng service, issuer whitelist, short TTL, scopes tối thiểu và key rotation; chỉ expose qua private network.
- **Rate limit:** Redis chia sẻ giữa các process/replica, thiết lập key phân vùng phù hợp IP/account/endpoint; không dùng memory-only limiter cho hệ thống triển khai nhiều instance.
- **UTC và integer VND:** không tin timezone/số tiền do client gửi; server tính nghiệp vụ theo UTC.
