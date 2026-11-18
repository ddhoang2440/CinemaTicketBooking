# BUSINESS RULES — Quy tắc nghiệp vụ

**Phân loại:** `R` quy tắc nền tảng; `P` quy tắc do nhóm xác nhận tại `DECISIONS.md` (13 quyết định ACCEPTED ngày 2026-11-18). Quy tắc được thực thi **server-side**; UI chỉ phản ánh trạng thái.

## 1. Tài khoản và quyền

| ID | Rule | Kết quả khi vi phạm |
|---|---|---|
| R-01 | Customer chỉ xem/sửa booking và profile của mình; Staff/Manager chỉ thao tác trong `cinema_scope`; Admin phạm vi toàn hệ thống | 403 hoặc 404 an toàn |
| R-02 | Backend validate role và resource ownership trên mọi endpoint nhạy cảm | 403 |
| R-03 | Email được chuẩn hóa khi đăng ký; xác minh trước khi kích hoạt customer | 400/409 |
| P-01 | Guest booking dùng email và guest access token ngẫu nhiên, hash ở DB; không cho tra cứu tùy tiện theo email | 401/403 |

## 2. Rạp, phòng và lịch chiếu

| ID | Rule | Chi tiết |
|---|---|---|
| R-04 | Ghế gắn đúng một phòng; loại ghế: `standard`, `vip`, `couple` | Ghế đôi có 2 seat ID liên kết bằng pair ID; luôn xử lý đủ cặp |
| R-05 | Suất chiếu gắn một phim, một phòng, thời gian và định dạng | Không đặt tại phòng không tương thích |
| R-06 | Không được có hai suất chiếu chồng thời gian trên cùng phòng | Check trong transaction; 409 |
| P-02 | Thêm buffer vệ sinh phòng **15 phút** sau suất | [ACCEPTED] |
| R-07 | Sau khi bán vé, không xóa/sửa sơ đồ ghế làm mất mapping vé | Thay đổi cần versioning hoặc chặn |
| P-03 | Không đặt vé cho suất đã `started` | 409 |

## 3. Giữ ghế — vấn đề trọng tâm

| ID | Rule | Chi tiết |
|---|---|---|
| R-08 | Mỗi `(showtime_id, seat_id)` tối đa một quyền giữ hiệu lực, hoặc một vé đã bán | Bảo vệ ở PostgreSQL, không chỉ trên UI |
| R-09 | `expires_at > NOW()` là điều kiện hold còn hiệu lực | Cleanup job không quyết định logic |
| P-04 | TTL giữ ghế = **5 phút** | [ACCEPTED]; giá trị cấu hình server |
| P-05 | Tối đa **8 ghế/booking** | [ACCEPTED] |
| R-10 | Create hold là thao tác nguyên tử; nếu thiếu 1 ghế thì rollback toàn bộ | Không partial hold |
| R-11 | Giá vé lấy từ server theo loại ghế, suất, quy định giá | Không tin giá client |
| P-06 | Client polling seat availability mỗi 10–15s khi ở màn chọn ghế | Không phải bảo đảm đồng thời; server vẫn là nguồn sự thật |

### Cơ chế đồng thời đề xuất

1. Transaction khóa hàng `showtimes` theo ID (serialize mọi thay đổi ghế của một suất ở quy mô đồ án).
2. Xóa/đánh dấu hết hạn các `seat_holds` cũ cho suất trong cùng transaction.
3. Kiểm tra mỗi ghế: thuộc đúng phòng, không có `tickets` hợp lệ đã bán và không có hold hiệu lực của người khác.
4. Ghi holds; tạo/refresh hold group phù hợp; commit.
5. Khi xác nhận thanh toán, Booking gọi Showtime qua signed service JWT; Showtime khóa showtime row, tái kiểm tra quyền hold và tạo seat allocations nguyên tử. Chỉ khi Showtime trả kết quả thành công thì Booking phát hành ticket. Partial unique `(showtime_id, seat_id) WHERE status='active'` trên allocations là lớp bảo vệ cuối; vé đã hủy được giữ lịch sử.

**Không thực hiện** `SELECT` trạng thái rồi `INSERT` ngoài transaction. Đề xuất khóa showtime đơn giản nhưng có thể giảm throughput; performance phải được đo. Khi một vé bị hủy và được bán lại, mô hình cần sử dụng `seat_allocations`/trạng thái active với unique partial index hoặc giữ lịch sử ở bảng khác; xem ERD.

## 4. Booking, checkout và payment

| ID | Rule | Chi tiết |
|---|---|---|
| R-12 | Booking tạo từ hold thuộc cùng phiên/customer; số tiền tính server-side | 400/403/409 |
| R-13 | Chỉ phát hành vé khi đã xác nhận thanh toán hợp lệ | `confirmed` mới có QR |
| R-14 | Webhook phải xác minh HMAC SHA-256, timestamp/replay guard và idempotency | Không tin trạng thái từ client |
| R-15 | Một `provider_event_id` chỉ xử lý một lần; `idempotency_key` được scoped theo người/flow | Tránh cấp vé trùng |
| R-16 | Booking có vòng đời minh bạch | Xem bảng trạng thái |
| P-07 | Thanh toán mock tạo order pending, callback trong 5 phút giữ ghế | [ACCEPTED] |
| P-08 | Nếu tiền đến sau khi hold mất quyền, chuyển `refund_pending/manual_review`; không phát vé | [ACCEPTED] |

**Booking states [ĐỀ XUẤT]:** `pending_payment` → `confirmed` / `payment_failed` / `expired`; `confirmed` → `cancelled` khi hợp lệ. Tránh chuyển ngược tùy tiện. `payment` có `initiated`, `succeeded`, `failed`, `refunded`, `refund_pending`.

**Bắp nước:** số lượng nguyên không âm, còn bán, giá snapshot trong booking items. Giá vé và ưu đãi không suy ra từ client; tiền dùng **integer VND** để tránh sai số số thực.

## 5. Vé QR / check-in

| ID | Rule | Chi tiết |
|---|---|---|
| R-17 | QR chứa mã vé ngẫu nhiên hoặc signed token không có PII; không thể đoán tuần tự | Hash token ở DB nếu dùng mã bearer |
| R-18 | Staff chỉ check-in vé thuộc suất/rạp mình được phép | 403 |
| R-19 | Vé chỉ check-in thành công 1 lần; cập nhật bằng transaction hoặc compare-and-set | 409 nếu dùng lại |
| R-20 | Vé hủy/void không được check-in | 409 |
| P-09 | Cho check-in trong khoảng thời gian [-30,+30] phút quanh giờ bắt đầu | [ACCEPTED] |

## 6. Hủy, hoàn tiền, báo cáo

| ID | Rule | Chi tiết |
|---|---|---|
| R-21 | Việc hủy phải đúng chính sách và lưu dấu vết; không hoàn tiền mù | Cần chính sách tường minh |
| P-10 | Chỉ cho hủy trước suất ≥120 phút và chưa check-in; hoàn tiền mock theo chính sách | [ACCEPTED] |
| R-22 | Doanh thu chỉ tính tiền thanh toán xác nhận, trừ refund; phân quyền theo rạp | Không tính pending |
| R-23 | Tỉ lệ lấp đầy = vé hợp lệ đã bán / tổng số ghế có thể bán của suất | Phải hiển thị mẫu số rõ ràng |
| P-11 | Sau khi hoàn tiền, giải phóng allocation nếu còn trước suất và chưa check-in | [ACCEPTED] |

## 7. Ma trận edge cases

| Case | Expected result |
|---|---|
| Hai khách giữ cùng ghế | Một thành công, một 409; không trùng hold |
| Hold hết hạn khi đang checkout | 409/410; khóa thanh toán, chọn lại ghế |
| Refresh trang sau hold | Khôi phục bằng hold ID/token còn hiệu lực, hoặc thông báo hết hạn |
| Webhook lặp 3 lần | Một payment outcome, một bộ vé |
| Webhook HMAC sai | 401 và security log |
| Thanh toán thành công sau expiry | Đối soát/refund pending, không bán trùng |
| Hủy vé đã check-in | Từ chối |
| Manager truy cập rạp khác | 403/404 |
| QR quét lần hai | 409, ghi nhận thử quét |
| Hai nhân viên quét cùng QR | Một thành công, một 409 |
| Giá client bị sửa | Backend bỏ qua và tính lại |
| Xóa phòng đang có vé | 409, không mất lịch sử |

## 8. Điều kiện đóng quyết định

Các quy tắc P liên quan D-05..D-15 đã được xác nhận 2026-11-18; xem `docs/DECISIONS.md`. Các lựa chọn chi tiết khác ngoài các D này vẫn được xem là triển khai đề xuất, không tự nhận là yêu cầu của giảng viên.


## Chính sách ghế đôi và giới hạn đặt vé — ACCEPTED D-06/D-15

- Mỗi ghế vật lý là một `seat_id`; hai ghế đôi cùng `couple_pair_id`, mỗi cặp chính xác 2 ID trong một auditorium.
- Yêu cầu giữ/đặt một phía của cặp mà không có phía còn lại → HTTP 422; nếu một phía bị chiếm → toàn yêu cầu 409.
- Giới hạn 8 tính theo số seat ID vật lý, vì vậy 1 cặp ghế đôi tính 2.
- Giá của cặp là tổng 2 giá đơn vị (hoặc snapshot được cấu hình tương đương); server là nguồn tính tiền.
- Hủy/refund xử lý toàn bộ booking và nhả cả cặp cùng transaction; không tách lẻ cặp.

## Quy tắc các dịch vụ — ACCEPTED D-04/D-12/D-13/D-14/D-18

- Năm Express processes phân vùng business logic; chỉ Showtime ghi `seat_holds`/`seat_allocations` qua API nội bộ có signed service JWT.
- Redis giữ bộ đếm rate limit dùng chung, không dùng Redis thay PostgreSQL cho seat truth.
- Giá lưu integer VND (`BIGINT`), mọi thời điểm lưu UTC, hiển thị VN; check-in chỉ [-30,+30] phút, hủy phải trước suất ≥120 phút và chưa check-in.
