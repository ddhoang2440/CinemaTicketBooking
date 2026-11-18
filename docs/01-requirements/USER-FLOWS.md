# USER FLOWS — Luồng nghiệp vụ và trạng thái (Kiến trúc 3 Dịch vụ)

**Quy ước:** Bước `→` là chuyển tiếp; nhánh lỗi phải có thông báo và cách xử lý. Không coi các mock UI là kết quả nghiệp vụ nếu server chưa xác nhận.

## UF-01 — Chuẩn bị hệ thống (Admin/Manager — Core Service)

1. Admin đăng nhập → quản lý cụm rạp → tạo rạp (tên/địa chỉ) → tạo phòng (sức chứa, loại định dạng) → vẽ sơ đồ ghế (hàng, số, thường/VIP/đôi) → lưu vào schema `core`.
2. Admin thêm/quản lý tài khoản nhân viên, gán rạp và vai trò → Core Service ghi audit log.
3. Manager tạo/cập nhật phim (theo quyền) → đặt thời gian, định dạng, lịch chiếu → đặt giá theo loại ghế/định dạng → kiểm tra trùng lịch + buffer 15 phút → `on_sale`.
4. Hệ thống công khai dữ liệu phim, rạp, giờ chiếu cho Guest/Customer.

## UF-02 — Đăng ký và xác thực (Core Service + Notification Service)

Guest mở đăng ký → nhập tên, email, mật khẩu → client Zod và Core Service validate → tạo tài khoản pending trong `core.users` → Core gọi `notification-service` gửi email xác minh (Mailpit trong demo) → nhấp liên kết hợp lệ → tài khoản active → đăng nhập → server trả access token và refresh cookie.

## UF-03 — Xem và chọn suất (Core Service)

Home → phim đang chiếu/sắp chiếu → tìm theo tiêu đề hoặc autocomplete → lọc theo rạp, ngày, 2D/3D/IMAX, khung giờ → chi tiết phim → chọn suất → gọi `GET /api/v1/showtimes/{id}/seats` trên Core Service → hiển thị bản đồ ghế và giá.

## UF-04 — Giữ ghế (Core Service)

1. Khách chọn 1..N ghế trên UI (N ≤ 8 ghế vật lý, ghế đôi tính 2) → gửi `POST /api/v1/seat-holds` với `showtimeId`, `seatIds` và `Idempotency-Key`.
2. Core Service xác thực ghế thuộc phòng, đủ cặp ghế đôi, showtime đang bán và không có hold hiệu lực hoặc ghế đã phân bổ.
3. DB transaction khóa hàng `core.showtimes` → dọn hold hết hạn → tạo hold mới có `expiresAt = now() + 300s`, trả hold ID và giá tính tại server.
4. Client hiển thị đếm ngược 5 phút, cho tiếp tục checkout trước khi hết hạn.

## UF-05 — Guest/Customer checkout, thanh toán và nhận vé (Core ↔ Payment ↔ Notification)

1. Khách đang giữ ghế → chọn bắp nước và số lượng → nhập thông tin liên hệ → tạo booking `pending_payment` tại Core Service (`POST /api/v1/bookings`).
2. Core kiểm tra hold còn hiệu lực, tính tổng tiền integer VND và gọi `payment-service` (`POST /internal/payments/intents`) hoặc client gọi `POST /api/v1/payments` để khởi tạo payment intent.
3. `payment-service` xử lý thanh toán giả lập và nhận webhook có chữ ký HMAC (`POST /api/v1/payments/webhook`), xác minh chữ ký + chống replay + idempotency và lưu vào schema `payment`.
4. `payment-service` thông báo kết quả thanh toán sang `core-service` (`POST /internal/bookings/{bookingId}/payment-result` kèm signed service JWT).
5. `core-service` mở transaction khóa suất chiếu, xác nhận `seat_allocations` từ hold, đổi trạng thái booking sang `confirmed` và phát hành `tickets`/QR.
6. Sau khi cấp vé thành công, `core-service` gọi `notification-service` (`POST /internal/notifications/send`) để gửi email xác nhận kèm vé QR.

**Ngoại lệ bắt buộc kiểm soát:**
- **Callback thanh toán đến trễ sau khi hold đã hết hạn:** `core-service` từ chối cấp ghế/vé, đánh dấu đơn cần hoàn tiền và gọi `POST /internal/payments/{paymentId}/refund` trên `payment-service` để hoàn tiền giả lập (`refund_pending -> refunded`), đồng thời gửi thông báo cho khách qua `notification-service`.
- **Lỗi gửi email tại Notification Service:** không làm hủy bỏ trạng thái `confirmed` của booking và vé QR; `notification-service` lưu trạng thái retry.

## UF-06 — Xem vé, lịch sử và hủy (Core ↔ Payment ↔ Notification)

Customer (hoặc Guest kèm `X-Guest-Booking-Token`) xem booking và QR → chọn 'Hủy' nếu còn **ít nhất 120 phút** trước giờ chiếu và **chưa check-in** → `core-service` kiểm tra điều kiện, giải phóng `seat_allocations` nguyên tử (bao gồm cả cặp ghế đôi), gọi `payment-service` thực hiện mock refund và gọi `notification-service` gửi email xác nhận hủy/hoàn tiền.

## UF-07 — Soát vé bằng QR (Staff — Core Service)

Staff đăng nhập → chọn suất được phân công → quét QR → gọi `POST /api/v1/checkins/verify` và `POST /api/v1/checkins` trên Core Service → kiểm tra cửa sổ `[-30, +30]` phút quanh `starts_at` và ràng buộc `UNIQUE(ticket_id)` → cập nhật nguyên tử trạng thái vé `used` và ghi `core.ticket_checkins`.

## UF-08 — Báo cáo Manager (Core Service)

Manager đăng nhập → chọn rạp được phân công → khoảng ngày/phim/suất → Core Service tổng hợp doanh thu thanh toán thành công (trừ hoàn tiền), số vé bán và tỉ lệ lấp đầy.
