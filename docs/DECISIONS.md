# DECISIONS — ADR lite / Các điểm cần chốt

Bộ tài liệu dùng các nhãn: `SOURCE` = rõ trong đề, `PROPOSED` = phương án mặc định do người soạn thiết kế, `OPEN` = cần nhóm quyết định; `ACCEPTED` = quyết định đã được xác nhận; `ACCEPTED — REVISED` = quyết định đã được nhóm cập nhật chính thức.

| ID | Tình trạng | Nội dung | Mặc định đề xuất / Quyết định hiện hành | Tác động nếu đổi |
|---|---|---|---|---|
| D-01 | SOURCE | 5 thành viên, 160 giờ, triển khai full-stack theo module | 32h/TV (5 thành viên chia module trên 3 dịch vụ) | TEAM-PLAN |
| D-02 | SOURCE | React 19/Vite + Express 5 + PostgreSQL 17/Knex 3 | Theo đề | Repo/build |
| D-03 | SOURCE | REST + OpenAPI 3.1, SOAP không yêu cầu | Theo đề | API |
| D-04 | ACCEPTED — REVISED | Kiến trúc SOA chạy 3 Express service processes độc lập | **3 Express processes (`core-service`, `payment-service`, `notification-service`), 1 PostgreSQL 17 chia 3 schema (`core`, `payment`, `notification`)**. Thiết kế 5 services trước đây bị thay thế (Superseded). | Backend structure, DB schemas, OpenAPI, Docker, CI, testing, ownership, docs |
| D-05 | ACCEPTED | TTL giữ ghế | TTL 5 phút (300 giây) | Seat hold, UI, tests |
| D-06 | ACCEPTED | Số ghế tối đa một booking | Tối đa 8 seat ID vật lý/booking (ghế đôi tính 2) | API/UX |
| D-07 | ACCEPTED | Cutoff hủy và refund | Hủy trước suất ≥120 phút, chưa check-in, mock refund qua Payment Service | Cancellation/payments |
| D-08 | ACCEPTED | Phạm vi guest booking | Guest booking bằng email + random guest access token (chỉ lưu hash) | Auth/booking |
| D-09 | ACCEPTED | Payment mock | Payment Service sở hữu mock adapter + webhook HMAC; verify signature/replay/idempotency | Webhook/integration |
| D-10 | ACCEPTED | QR admission window | QR check-in từ -30 đến +30 phút tính từ starts_at | Check-in |
| D-11 | ACCEPTED | Buffer phòng giữa 2 suất | Buffer phòng 15 phút giữa các suất | Showtime validation |
| D-12 | ACCEPTED | Seat authoritative ownership | Core Service (`showtimes`/`seat-holds` modules) sở hữu seat allocation trong schema `core`; PostgreSQL locks + unique active constraints | Core/Payment workflow |
| D-13 | ACCEPTED | Internal auth | Signed service JWT với issuer/audience/scope/TTL ngắn giữa `core-service`, `payment-service`, `notification-service` | Internal endpoints |
| D-14 | ACCEPTED | Shared rate-limit storage | Redis dùng chung cho rate limiting | Security/deploy |
| D-15 | ACCEPTED | Ghế đôi | Hai seat ID liên kết (`couple_pair_id`), hold và bán cả cặp nguyên tử | ERD/pricing |
| D-16 | SOURCE | Seed có lịch chiếu 20/12/2026 19:30 VN | Bắt buộc (`2026-12-20T12:30:00Z`) | Seed/e2e |
| D-17 | SOURCE | Coverage API 60%; API list <200ms, seats <100ms | Chứng minh bằng đo trên `backend/` | TESTING |
| D-18 | ACCEPTED | Giữ tiền integer VND, timestamps UTC | Integer VND (`BIGINT`) + UTC timestamp (`timestamptz`) | DB/API |

## Chi tiết cập nhật D-04 (`ACCEPTED — REVISED`)

- **Ngày quyết định:** 2026-11-18 (Asia/Ho_Chi_Minh).
- **Trạng thái:** `ACCEPTED — REVISED`.
- **Thiết kế trước đây:** 5 Express service processes (`identity-service`, `catalog-service`, `showtime-service`, `booking-service`, `operations-service`) với 5 schema PostgreSQL — **Superseded (Đã thay thế)**.
- **Thiết kế mới:** 3 Express service processes độc lập:
  1. **Core Service (`core-service`, port `4001`, schema `core`)**: Chứa các module nghiệp vụ cốt lõi (`auth`, `users`, `roles`, `movies`, `cinemas`, `auditoriums`, `seats`, `showtimes`, `pricing`, `seat-holds`, `bookings`, `concessions`, `tickets`, `checkins`, `reports`).
  2. **Payment Service (`payment-service`, port `4002`, schema `payment`)**: Chứa các module xử lý thanh toán, đối soát webhook HMAC và hoàn tiền (`payments`, `webhooks`, `refunds`).
  3. **Notification Service (`notification-service`, port `4003`, schema `notification`)**: Chứa các module gửi thông báo email, mẫu thông báo và theo dõi trạng thái gửi (`email`, `templates`, `delivery`).
- **Lý do (Reason):** Bám sát cấu trúc dịch vụ Core, Payment và Notification của đề bài, đồng thời giảm độ phức tạp hệ phân tán không cần thiết giữa giữ ghế, đặt vé, danh mục và soát vé (vốn cùng thuộc miền nghiệp vụ rạp cốt lõi).
- **Tác động chuyển đổi (Migration Impact):** Cấu trúc thư mục `backend/`, phân vùng schema PostgreSQL (`core`, `payment`, `notification`), hợp đồng OpenAPI (`openapi/cinema-api.yaml`, `openapi/internal-api.yaml`), Docker Compose, CI, kiểm thử, phân công `CODEOWNERS` cho 5 thành viên và toàn bộ tài liệu kiến trúc.

## Quy trình duyệt

1. 13 quyết định (D-04..D-15, D-18) đã được nhóm xác nhận ngày 18/11/2026; D-04 được cập nhật sang `ACCEPTED — REVISED` cùng ngày.
2. Mọi sửa đổi quyết định ACCEPTED phải có ADR mới, người duyệt, lý do và đánh giá tác động.
3. Cập nhật đồng bộ PRD, BUSINESS-RULES, USER-FLOWS, ERD, OpenAPI và TESTING trước khi code phần liên quan.
4. Nếu thay đổi sau W2, tạo ADR và đánh giá tác động tới các module gọi API.

## Nhật ký xác nhận

- **Ngày:** 2026-11-18 (Asia/Ho_Chi_Minh).
- **Quyết định giữ nguyên:** D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14, D-15, D-18.
- **Quyết định cập nhật:** D-04 (`ACCEPTED — REVISED` — chuyển từ 5 services sang 3 services: Core, Payment, Notification).
- **Lưu ý:** ACCEPTED là duyệt thiết kế và khung dự án (scaffolding), không khẳng định tính năng nghiệp vụ đã triển khai hoàn chỉnh.
