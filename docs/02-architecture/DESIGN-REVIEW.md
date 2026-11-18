# Design Review — kết quả rà soát chi tiết (18/11/2026 — Cập nhật kiến trúc 3 dịch vụ)

**Căn cứ:** bộ tài liệu `ACCEPTED` và `D-04 (ACCEPTED — REVISED: 3 Express services)`. Đây là **review thiết kế, hợp đồng và khung dự án (scaffolding)**, chưa phải xác nhận tính năng nghiệp vụ đã chạy thật.

## 1. Vấn đề phát hiện và giải pháp

| ID | Mức độ | Vấn đề trước đây | Giải pháp trong kiến trúc 3 dịch vụ hiện hành | Owner |
|---|---|---|---|---|
| RV-01 | High | ERD cần thống nhất mô hình ghế đôi theo D-15 | Thống nhất cặp 2 `seat_id` liên kết qua `core.seat_pairs` / `couple_pair_id`, validate đủ cặp ngay trong transaction tại Core Service | TV2/TV3 |
| RV-02 | Critical | Thanh toán có thể hoàn tất sau khi hold hết hạn | Payment Service báo kết quả về Core Service; Core chỉ cấp vé khi xác nhận phân bổ ghế thành công; nếu hold đã hết hạn thì gọi Payment Service thực hiện `refund_pending -> refunded` | TV3/TV4 |
| RV-03 | Critical | Partial unique với `now()` là không hợp lệ trong PostgreSQL | Dùng trạng thái `status='active'` + khóa hàng `core.showtimes` + expire-on-read dưới transaction; confirm idempotent | TV3 |
| RV-04 | High | 5 microservices gây phân mảnh giao dịch giữa giữ ghế, đặt vé và soát vé | **Cập nhật D-04 (`ACCEPTED — REVISED`)**: Gộp miền nghiệp vụ rạp cốt lõi vào `core-service` (schema `core`), tách riêng `payment-service` (schema `payment`) và `notification-service` (schema `notification`). Giao tiếp liên dịch vụ qua signed service JWT | Tất cả |
| RV-05 | High | Hợp đồng OpenAPI cần phản ánh đúng ranh giới 3 dịch vụ | Đồng bộ `openapi/cinema-api.yaml` (public) và `openapi/internal-api.yaml` (internal giữa Core, Payment và Notification) | Tất cả |
| RV-06 | High | Hoàn tiền và hủy booking giữa Core và Payment | Core kiểm tra cutoff ≥120 phút và chưa check-in, chuyển `cancellation_pending`, giải phóng ghế trong `core` và gọi Payment Service xử lý hoàn tiền giả lập, sau đó gọi Notification Service gửi email | TV3/TV4/TV5 |
| RV-07 | High | Check-in soát vé và hủy vé có thể chạy đua | Trong `core-service`, cả `bookings` và `checkins` cùng nằm trên schema `core`, cho phép kiểm tra và khóa nguyên tử trạng thái vé/booking trong cùng một giao dịch PostgreSQL | TV4/TV5 |
| RV-08 | Medium | Ràng buộc thời gian suất chiếu và buffer 15 phút | Dùng exclusion constraint `btree_gist` có cộng buffer 15 phút trên `core.showtimes` | TV2/TV3 |
| RV-09 | Medium | Guest token cần chính sách vòng đời | Lưu hash trong `core.bookings`, scope duy nhất theo booking; không lộ token qua URL logs | TV1/TV4 |
| RV-10 | Medium | Lỗi gửi email không được làm hỏng đơn đã thanh toán | `notification-service` tách biệt ở schema `notification`; lỗi gửi được ghi nhận retry/delivery log mà không rollback booking đã `confirmed` | TV4/TV5 |

## 2. Ma trận ownership trên 3 PostgreSQL schemas

| Schema | Service sở hữu | Modules & Bảng dữ liệu (Source of Truth) | TV phụ trách | External references (UUID logic, không FK chéo schema) |
|---|---|---|---|---|
| `core` | `core-service` (`:4001`) | `users`, `roles`, `user_roles`, `refresh_sessions`, `email_verifications` (TV1); `movies`, `cinemas`, `auditoriums`, `seat_pairs`, `seats` (TV2); `showtimes`, `ticket_prices`, `seat_hold_groups`, `seat_holds`, `seat_allocations` (TV3); `bookings`, `booking_seats`, `concessions`, `booking_concessions`, `tickets` (TV4); `ticket_checkins`, `audit_logs` (TV5) | TV1–TV5 | `payment_id` (tham chiếu logic tới `payment.payments`) |
| `payment` | `payment-service` (`:4002`) | `payments`, `payment_events`, `refunds` | TV4 | `booking_id` (tham chiếu logic tới `core.bookings`) |
| `notification` | `notification-service` (`:4003`) | `notification_deliveries`, `notification_templates` | TV5 | `booking_id`, `payment_id`, `user_id` (tham chiếu logic) |

## 3. Quy tắc tích hợp thống nhất

1. **Core Service** sở hữu toàn bộ vòng đời ghế, suất chiếu, đơn đặt vé, vé QR và check-in trên schema `core`. Nhờ đó, việc xác thực ghế đôi (`seats`), giữ ghế (`seat-holds`), tạo đơn (`bookings`), phát hành vé (`tickets`) và soát vé (`checkins`) có thể sử dụng giao dịch và khóa trực tiếp trên PostgreSQL mà không bị độ trễ mạng nội bộ.
2. **Payment Service** sở hữu toàn bộ trạng thái thanh toán, đối soát chữ ký HMAC webhook và hoàn tiền trên schema `payment`. Core Service không bao giờ ghi trực tiếp vào bảng của schema `payment`.
3. **Notification Service** nhận yêu cầu gửi email từ Core/Payment qua `/internal/notifications/*` (xác thực bằng signed service JWT), lưu lịch sử gửi ở schema `notification` và gửi qua Mailpit/SMTP.
4. Tất cả số tiền lưu `BIGINT` VND và thời gian lưu `timestamptz` UTC (D-18).
