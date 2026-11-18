# USER FLOWS — Luồng nghiệp vụ và trạng thái

**Quy ước:** Bước `→` là chuyển tiếp; nhánh lỗi phải có thông báo và cách xử lý. Không coi các mock UI là kết quả nghiệp vụ nếu server chưa xác nhận.

## UF-01 — Chuẩn bị hệ thống (Admin/Manager)

1. Admin đăng nhập → quản lý cụm rạp → tạo rạp (tên/địa chỉ) → tạo phòng (sức chứa, loại định dạng) → vẽ sơ đồ ghế (hàng, số, thường/VIP/đôi) → lưu.
2. Admin thêm/quản lý tài khoản nhân viên, gán rạp và vai trò → backend ghi audit log.
3. Manager tạo/cập nhật phim (theo quyền) → đặt thời gian, định dạng, lịch chiếu → đặt giá theo loại ghế/định dạng → kiểm tra trùng lịch → `on_sale`.
4. Hệ thống công khai dữ liệu phim, rạp, giờ chiếu cho Guest/Customer.

**Ngoại lệ:** Phòng có suất chưa kết thúc không cho chỉnh sơ đồ ghế làm mất ánh xạ vé; lịch trùng phòng trả 409; manager khác phạm vi rạp bị 403.

## UF-02 — Đăng ký và xác thực

Guest mở đăng ký → nhập tên, email, mật khẩu → client Zod và server validate → tạo tài khoản pending → gửi email xác minh (Mailpit trong demo) → nhấp liên kết hợp lệ → tài khoản active → đăng nhập → server trả access token và refresh cookie.

**Ngoại lệ:** email không hợp lệ hoặc đã dùng trả thông điệp phù hợp, tránh lộ tài khoản không cần thiết; token hết hạn có luồng gửi lại có rate limit; mật khẩu sai không cấp access.

## UF-03 — Xem và chọn suất

Home → phim đang chiếu/sắp chiếu → tìm theo tiêu đề hoặc autocomplete → lọc theo rạp, ngày, 2D/3D/IMAX, khung giờ → chi tiết phim → chọn suất → gọi `/showtimes/{id}/seats` → hiển thị bản đồ ghế và giá.

**Ngoại lệ:** hết suất, lịch đã bắt đầu, rạp tạm đóng, API lỗi → thông báo và cho chọn lịch khác.

## UF-04 — Giữ ghế

1. Khách chọn 1..N ghế trên UI (N mặc định đề xuất ≤8) → gửi request giữ ghế với `showtimeId`, `seatIds` và idempotency key.
2. Backend xác thực ghế thuộc phòng, showtime đang bán và không có hold hiệu lực hoặc vé bán.
3. DB transaction khóa/ghi nhận quyền sở hữu ghế → tạo hold có `expiresAt`, trả hold token/ID và giá được tính lại ở server.
4. Client hiển thị đếm ngược, cho tiếp tục checkout trước hết hạn.
5. Đến hạn, server coi hold không còn hiệu lực; công việc cleanup là tối ưu, không thay thế kiểm tra `expires_at` trong transaction.

**Ngoại lệ:** 409 nếu có ghế tranh chấp, trả danh sách ghế không khả dụng và tải lại sơ đồ; reconnect/reload vẫn có thể khôi phục hold bằng token phiên nếu còn hiệu lực; không tự kéo dài hold bằng thao tác UI.

## UF-05 — Guest/Customer checkout và thanh toán

Khách đang giữ ghế → chọn bắp nước và số lượng → nhập email/điện thoại/thông tin cần thiết → xem bảng tổng kết từ server → chấp nhận điều khoản → tạo booking `pending_payment` liên kết hold → tạo payment intent → chuyển sang UI thanh toán giả lập → provider gửi webhook có chữ ký → server xác minh + xử lý idempotent → đổi trạng thái booking thành `confirmed` và cấp tickets/QR → gửi email và hiển thị success.

**Ngoại lệ phải test:**
- Người dùng rời trang: booking/hold hết hạn thì không cấp vé.
- Payment thất bại: booking `payment_failed`, ghế được giải phóng khi hết/thu hồi hold.
- Webhook trùng: không nhân đôi booking/tickets.
- Callback đến trễ sau hold expiry: không tự cấp vé; ghi nhận trạng thái cần hoàn/đối soát mock.
- Giá thay đổi giữa chọn ghế và thanh toán: số tiền cuối do backend snapshot/kiểm tra, hiển thị thông báo trước khi xác nhận.

## UF-06 — Xem vé, lịch sử và hủy

Customer vào 'Vé của tôi' → lọc theo ngày/trạng thái → xem booking và QR → chọn 'Hủy' nếu hợp lệ → xác nhận chính sách → backend kiểm tra quyền, cutoff, check-in và payment → hủy (và mock refund nếu áp dụng) → cập nhật báo cáo/ghế.

Guest nhận URL xác minh an toàn qua email → xem vé/hủy theo token + chính sách; không được tra cứu đơn của mọi người chỉ bằng email.

## UF-07 — Soát vé bằng QR (Staff)

Staff đăng nhập → chọn suất được phân công → quét QR hoặc nhập mã → API verify hiển thị tóm tắt (phim, suất, ghế, trạng thái) → nhấn 'Check-in' → API cập nhật nguyên tử `checked_in` cùng thời điểm/người thao tác → màn hình thành công.

**Ngoại lệ:** QR giả/hỏng/thuộc rạp khác/vé đã hủy/đã soát/không thuộc suất được chọn → từ chối rõ lý do cho nhân viên; không trả PII dư thừa.

## UF-08 — Báo cáo Manager

Manager đăng nhập → chọn rạp được phân công → khoảng ngày/phim/suất → API tổng hợp doanh thu thanh toán thành công (trừ hoàn tiền), số vé bán, tỉ lệ lấp đầy (vé hợp lệ / ghế khả dụng) → biểu đồ/bảng. Phải nêu rõ timezone, đơn vị VNĐ và ý nghĩa từng metric.

## UF-09 — Quản lý trạng thái suất

`draft` → `on_sale` → `started` → `completed`. Manager có thể ngừng bán (`sales_paused`) khi thích hợp; không xóa lịch đã có vé. Thời gian chuyển trạng thái do job hoặc thao tác có quyền; server phải xác minh thời điểm thực.

## UF-10 — Trạng thái trang chuẩn

| Trang | Loading | Empty | Error | Success |
|---|---|---|---|---|
| Danh sách phim | Skeleton | Không có phim phù hợp | Retry và thông báo | Danh sách phân trang |
| Chọn ghế | Skeleton seat map | Hết ghế trống | 409 + refresh | Hold + countdown |
| Checkout | Disabled submit khi đang xử lý | Không có hold | Payment failure/expiry | Confirmed + QR |
| Lịch sử | Skeleton | Chưa có vé | Retry | Vé theo trạng thái |
| Check-in | Loading verification | Chưa chọn suất | Invalid/used QR | Check-in success |
| Reports | Chart skeleton | Không có dữ liệu | Retry | KPI và biểu đồ |

## Trace từ user flows đến test

UF-01 → INT-ADMIN-01; UF-02 → INT-AUTH-01; UF-03 → E2E-CATALOG-01; UF-04 → CONC-SEAT-01; UF-05 → E2E-BOOK-01, INT-PAY-01; UF-06 → INT-CANCEL-01; UF-07 → E2E-CHECKIN-01; UF-08 → INT-REPORT-01. Xem `TESTING.md`.


## Luồng đã chốt — ACCEPTED (2026-11-18)

1. Chọn tối đa **8 seat ID vật lý**; nếu chọn một ghế đôi thì hệ thống tự chọn cả 2 ID hoặc từ chối chọn thiếu cặp (D-06/D-15).
2. Showtime giữ nguyên tử **5 phút**; UI đếm theo `expiresAt` do server cấp; hết hạn phải chọn lại, không tăng TTL bằng reload (D-05/D-12).
3. Khách chưa đăng nhập nhập email và nhận guest access token ngẫu nhiên; không cho truy xuất đơn bằng email đơn thuần (D-08).
4. Booking tạo mock payment; webhook ký HMAC và có chống replay; chỉ cấp QR sau khi confirm allocation thành công ở Showtime (D-09/D-12).
5. Hủy đơn chỉ khi còn **ít nhất 120 phút** đến suất và chưa check-in; hoàn tiền giả lập; không hủy lẻ một ghế đôi (D-07/D-15).
6. Staff check-in từ **30 phút trước đến 30 phút sau** giờ bắt đầu, mỗi vé chỉ một lần (D-10).
7. Showtime tạo lịch có **buffer 15 phút** trên cùng phòng (D-11). Tất cả thời điểm lưu UTC và hiển thị Asia/Ho_Chi_Minh (D-18).
