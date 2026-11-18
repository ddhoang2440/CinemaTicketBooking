# BUSINESS RULES — Quy tắc nghiệp vụ (Kiến trúc 3 Dịch vụ)

**Phân loại:** `R` quy tắc nền tảng; `P` quy tắc do nhóm xác nhận tại `DECISIONS.md` (bao gồm **D-04 `ACCEPTED — REVISED`** và D-05..D-18). Quy tắc được thực thi **server-side**; UI chỉ phản ánh trạng thái.

## 1. Tài khoản và quyền (`core-service`: `auth`, `users`, `roles`)

| ID | Rule | Kết quả khi vi phạm |
|---|---|---|
| R-01 | Customer chỉ xem/sửa booking và profile của mình; Staff/Manager chỉ thao tác trong `cinema_scope`; Admin phạm vi toàn hệ thống | 403 hoặc 404 an toàn |
| R-02 | Backend validate role và resource ownership trên mọi endpoint nhạy cảm | 403 |
| R-03 | Email được chuẩn hóa khi đăng ký; xác minh trước khi kích hoạt customer | 400/409 |
| P-01 | Guest booking dùng email và guest access token ngẫu nhiên, chỉ lưu hash ở `core.bookings`; không cho tra cứu tùy tiện theo email (D-08) | 401/403 |

## 2. Rạp, phòng và lịch chiếu (`core-service`: `movies`, `cinemas`, `auditoriums`, `seats`, `showtimes`)

| ID | Rule | Chi tiết |
|---|---|---|
| R-04 | Ghế gắn đúng một phòng; loại ghế: `standard`, `vip`, `couple` | Ghế đôi có 2 seat ID liên kết bằng `couple_pair_id`; luôn xử lý đủ cặp (D-15) |
| R-05 | Suất chiếu gắn một phim, một phòng, thời gian và định dạng | Không đặt tại phòng không tương thích |
| R-06 | Không được có hai suất chiếu chồng thời gian trên cùng phòng | Check trong transaction / exclusion constraint; 409 |
| P-02 | Thêm buffer vệ sinh phòng **15 phút** sau mỗi suất chiếu | [ACCEPTED D-11] |
| R-07 | Sau khi bán vé, không xóa/sửa sơ đồ ghế làm mất mapping vé | Thay đổi cần versioning hoặc chặn |
| P-03 | Không đặt vé cho suất đã `started` | 409 |

## 3. Giữ ghế & Phân bổ ghế (`core-service`: `seat-holds`)

| ID | Rule | Chi tiết |
|---|---|---|
| R-08 | Mỗi `(showtime_id, seat_id)` tối đa một quyền giữ hiệu lực, hoặc một phân bổ ghế đã bán | Bảo vệ ở PostgreSQL schema `core`, không chỉ trên UI (D-12) |
| R-09 | `expires_at > NOW()` là điều kiện hold còn hiệu lực | Cleanup job không quyết định logic |
| P-04 | TTL giữ ghế = **5 phút (300 giây)** | [ACCEPTED D-05]; giá trị cấu hình server |
| P-05 | Tối đa **8 ghế vật lý/booking** (ghế đôi tính 2) | [ACCEPTED D-06, D-15] |
| R-10 | Create hold là thao tác nguyên tử; nếu thiếu 1 ghế hoặc thiếu nửa cặp ghế đôi thì rollback toàn bộ | 409 (occupied) hoặc 422 (incomplete pair) |
| R-11 | Giá vé lấy từ server (`core.ticket_prices`) theo loại ghế và suất chiếu | Không tin giá client (D-18) |

## 4. Booking, Payment & Notification (`core-service` ↔ `payment-service` ↔ `notification-service`)

| ID | Rule | Chi tiết |
|---|---|---|
| R-12 | Booking tạo từ hold còn hiệu lực; số tiền VND tính server-side | 400/403/409/410 |
| R-13 | Chỉ phát hành vé (`core.tickets`) sau khi Payment Service xác nhận thanh toán và Core Service hoàn tất `core.seat_allocations` | `confirmed` mới có QR |
| R-14 | `payment-service` phải xác minh HMAC SHA-256 trên raw body webhook, kiểm tra timestamp/replay guard và idempotency | Không tin trạng thái thanh toán từ trình duyệt (D-09) |
| R-15 | Một `provider_event_id` chỉ xử lý một lần tại `payment.payment_events` | Tránh cấp vé trùng |
| P-07 | Thanh toán mock tạo intent ở `payment-service`, callback webhook trong thời gian giữ ghế | [ACCEPTED D-09] |
| P-08 | Nếu thanh toán thành công đến sau khi hold đã hết hạn, Core không phát vé và yêu cầu Payment Service thực hiện hoàn tiền (`refund_pending -> refunded`) | [ACCEPTED] |
| R-16 | Lỗi gửi email tại `notification-service` không làm rollback hay vô hiệu hóa một booking đã `confirmed` | Xử lý bất đồng bộ / retry an toàn |

## 5. Vé QR, Soát vé & Hủy vé (`core-service` & `payment-service`)

| ID | Rule | Chi tiết |
|---|---|---|
| R-17 | QR chứa mã vé ngẫu nhiên hoặc signed token không có PII; lưu hash ở `core.tickets` | Không đoán được tuần tự |
| R-18 | Staff chỉ check-in vé thuộc suất/rạp mình được phép | 403 |
| R-19 | Vé chỉ check-in thành công 1 lần (`UNIQUE(ticket_id)` tại `core.ticket_checkins`) | 409 nếu quét lại |
| P-09 | Cho phép check-in trong khoảng thời gian **[-30, +30] phút** quanh `starts_at` | [ACCEPTED D-10] |
| P-10 | Chỉ cho phép hủy trước suất **≥120 phút** và khi **chưa check-in**; giải phóng cả cặp ghế đôi tại Core và hoàn tiền giả lập tại Payment Service | [ACCEPTED D-07, D-15] |

## 6. Quy tắc ranh giới 3 dịch vụ — ACCEPTED — REVISED D-04 / D-12 / D-13 / D-14 / D-18

- **3 Express processes độc lập**: `core-service` (schema `core`), `payment-service` (schema `payment`), `notification-service` (schema `notification`). Không truy vấn trực tiếp bảng thuộc schema của service khác.
- Giao tiếp nội bộ `/internal/*` giữa 3 services bắt buộc dùng **signed service JWT (D-13)**.
- **Redis (D-14)** giữ bộ đếm rate limit dùng chung; PostgreSQL schema `core` là nguồn sự thật duy nhất của ghế và vé.
- Tiền lưu integer VND (`BIGINT`), thời gian lưu UTC (`timestamptz`), hiển thị `Asia/Ho_Chi_Minh` (D-18).
