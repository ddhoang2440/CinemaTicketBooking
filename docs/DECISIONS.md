# DECISIONS — ADR lite / Các điểm cần chốt

Bộ tài liệu dùng 4 nhãn: `SOURCE` = rõ trong đề, `PROPOSED` = phương án mặc định do người soạn thiết kế, `OPEN` = cần nhóm quyết định; `ACCEPTED` = quyết định đã được xác nhận.

| ID | Tình trạng | Nội dung | Mặc định đề xuất | Tác động nếu đổi |
|---|---|---|---|---|
| D-01 | SOURCE | 5 thành viên, 160 giờ, triển khai full-stack theo module | 32h/TV | TEAM-PLAN |
| D-02 | SOURCE | React 19/Vite + Express 5 + PostgreSQL 17/Knex 3 | Theo đề | Repo/build |
| D-03 | SOURCE | REST + OpenAPI 3.1, SOAP không yêu cầu | Theo đề | API |
| D-04 | ACCEPTED | SOA logical modules chạy 5 Express processes | 5 Express processes, 1 PostgreSQL chia 5 schema (identity/catalog/showtime/booking/operations) | ARCHITECTURE, Docker |
| D-05 | ACCEPTED | TTL giữ ghế | TTL 5 phút (300 giây) | Seat hold, UI, tests |
| D-06 | ACCEPTED | Số ghế tối đa một booking | Tối đa 8 seat ID vật lý/booking (ghế đôi tính 2) | API/UX |
| D-07 | ACCEPTED | Cutoff hủy và refund | Hủy trước suất ≥120 phút, chưa check-in, mock refund | Cancellation/payments |
| D-08 | ACCEPTED | Phạm vi guest booking | Guest booking bằng email + random guest access token (chỉ lưu hash) | Auth/booking |
| D-09 | ACCEPTED | Payment mock | Mock adapter + webhook HMAC; verify signature/replay/idempotency | Webhook/integration |
| D-10 | ACCEPTED | QR admission window | QR check-in từ -30 đến +30 phút tính từ starts_at | Check-in |
| D-11 | ACCEPTED | Buffer phòng giữa 2 suất | Buffer phòng 15 phút giữa các suất | Showtime validation |
| D-12 | ACCEPTED | Seat authoritative ownership | Showtime sở hữu seat allocation; PostgreSQL locks + unique active constraints | Booking/Showtime |
| D-13 | ACCEPTED | Internal auth | Signed service JWT với issuer/audience/scope/TTL ngắn | Internal endpoints |
| D-14 | ACCEPTED | PostgreSQL storage for rate limits? | Redis dùng chung cho rate limiting | Security/deploy |
| D-15 | ACCEPTED | Ghế đôi | Hai seat ID liên kết, hold và bán cả cặp nguyên tử | ERD/pricing |
| D-16 | SOURCE | Seed có lịch chiếu 20/12/2026 19:30 VN | Bắt buộc | Seed/e2e |
| D-17 | SOURCE | Coverage API 60%; API list <200ms, seats <100ms | Chứng minh bằng đo | TESTING |
| D-18 | ACCEPTED | Giữ tiền integer VND, timestamps UTC | Integer VND (BIGINT) + UTC timestamp (timestamptz) | DB/API |

## Quy trình duyệt

1. 13 quyết định được người đại diện nhóm xác nhận ngày 18/11/2026.
2. Mọi sửa đổi quyết định ACCEPTED phải có ADR mới, người duyệt, lý do và đánh giá tác động.
3. Cập nhật đồng bộ PRD, BUSINESS-RULES, USER-FLOWS, ERD, OpenAPI và TESTING trước khi code phần liên quan.
4. Nếu thay đổi sau W2, tạo ADR và đánh giá tác động tới các module gọi API.

## Nhật ký xác nhận

- **Ngày:** 2026-11-18 (Asia/Ho_Chi_Minh).
- **Người chốt:** đại diện nhóm trong cuộc trò chuyện; chưa có tên/biên bản đồng thuận của từng thành viên.
- **Quyết định:** D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14, D-15, D-18.
- **Lý do:** phù hợp chia module full-stack, giới hạn phạm vi 160h, đảm bảo seat concurrency và giao tiếp an toàn.
- **Lưu ý:** ACCEPTED là duyệt thiết kế, không khẳng định code đã triển khai hoặc test đã chạy.
