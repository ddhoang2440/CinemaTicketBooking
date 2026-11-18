# Design Review — kết quả rà soát chi tiết (18/11/2026)

**Căn cứ:** bộ tài liệu `ACCEPTED` v2, 13 quyết định D-04…D-18. Đây là **review thiết kế và hợp đồng**, chưa phải xác nhận code chạy thật.

## 1. Vấn đề phát hiện và giải pháp

| ID | Mức độ | Vấn đề trong bản v2 | Giải pháp trong bản v3 | Owner |
|---|---|---|---|---|
| RV-01 | High | ERD vẫn hỏi lựa chọn ghế đôi dù D-15 đã ACCEPTED | Thống nhất cặp 2 `seat_id`, thêm bản thiết kế `seat_pairs`, validate đủ cặp ngay transaction | TV2/TV3 |
| RV-02 | Critical | Thanh toán có thể đến sau khi hold hết hạn | Chỉ cấp vé khi Showtime xác nhận thành công; nếu không thì `refund_pending`, xử lý bù idempotent | TV3/TV4 |
| RV-03 | Critical | Partial unique với `now()` là không hợp lệ | Dùng trạng thái active + khóa hàng suất + expire-on-read dưới transaction; confirm idempotent | TV3 |
| RV-04 | High | 5 processes một DB dễ truy vấn chéo | 5 schemas, 5 DB roles, cấp quyền theo schema; giao tiếp nghiệp vụ bằng internal REST JWT | TV1/TV5 |
| RV-05 | High | Bản OpenAPI starter chỉ có 10 paths | Mở rộng public API + internal API, bổ sung business errors, schemas và authentication | Tất cả |
| RV-06 | High | Hoàn tiền và hủy booking phân tán | Booking phản hồi `cancellation_pending` / `refund_pending`; giải phóng ghế khi booking cancellation được ghi bền và workflow bù tiếp tục | TV3/TV4 |
| RV-07 | High | Check-in soát vé và hủy vé có thể chạy đua | Trước hủy cần trạng thái check-in; trong hệ phân tán dùng trạng thái `cancellation_pending` và kiểm tra authoritative ticket; phải test race check-in/cancel | TV4/TV5 |
| RV-08 | Medium | Cần ràng buộc thời gian suất và buffer | Khóa `auditorium_id` logic khi ghi lịch, dùng exclusion constraint có buffer 15 phút; kiểm định duration | TV2/TV3 |
| RV-09 | Medium | Guest token cần chính sách vòng đời | Lưu hash, scope duy nhất booking, thời hạn có thể cấu hình; không lộ token qua URL logs | TV1/TV4 |
| RV-10 | Medium | Tính tổng tiền không tin frontend | Snapshot giá vé/bắp nước phía server; chỉ nhận IDs và quantity, dùng integer VND | TV3/TV4 |

## 2. Ma trận ownership

| Schema | TV | Source of truth | External references (UUID, không dùng direct FK chéo schema) |
|---|---|---|---|
| `identity` | 1 | users, roles, sessions | `cinema_id` trong phân quyền |
| `catalog` | 2 | movies, cinemas, auditoriums, seats, seat_pairs | Không |
| `showtime` | 3 | showtimes, prices, holds, allocations | movie_id, auditorium_id, seat_id, owner_ref, booking_id |
| `booking` | 4 | bookings, payments, tickets, concessions | user_id, showtime_id, seat_id, hold_group_id |
| `operations` | 5 | ticket_checkins, audit | staff_id, ticket_id, cinema_id |

## 3. Quy tắc tích hợp thống nhất

1. `catalog` phát hành `seatId` và `couplePairId`; `showtime` kiểm tra seat map qua internal REST và lưu snapshot đủ để xử lý ghế theo suất.
2. `showtime` **không** tin status từ client, có transaction DB bảo vệ hold/confirm/release; trả giá quoted VND server-side.
3. `booking` là owner trạng thái đơn và payment; giữ toàn bộ side effects idempotent. Confirmation vào `showtime` phải được retry an toàn.
4. `operations` là owner check-in; gọi internal ticket verification, không cho phép check-in QR trùng.
5. Dịch vụ không tham chiếu trực tiếp schema của nhau dù chung PostgreSQL. SQL example là blueprint, cần chuyển sang Knex migrations.

## 4. Trạng thái nghiệp vụ (đề xuất triển khai, không thay đổi ACCEPTED)

- `hold`: ACTIVE → EXPIRED | RELEASED | CONSUMED; `expires_at` do Showtime server tạo tại `now()+300s`.
- `booking`: PENDING_PAYMENT → CONFIRMED | PAYMENT_FAILED | EXPIRED; CONFIRMED → CANCELLATION_PENDING → CANCELLED (nếu hợp lệ).
- `payment`: INITIATED → SUCCEEDED | FAILED; SUCCEEDED → REFUND_PENDING → REFUNDED.
- `ticket`: VALID → CANCELLED | USED; check-in duy nhất trong cửa sổ [-30,+30] phút tính theo `showtime.starts_at`.

### Phương án xử lý payment tới muộn

Webhook HMAC hợp lệ, `payment.status=SUCCEEDED`, nhưng Showtime báo hold hết hạn/ghế đã được người khác mua: **không cấp vé**; ghi `booking.status=PAYMENT_FAILED` hoặc trạng thái cần bù theo contract, `payment.status=REFUND_PENDING`; chạy refund mock và đối soát. Trả 200 cho webhook đã ghi bền để hạn chế gửi lặp, nhưng retry job tiếp tục tới trạng thái cuối. Nếu lost response sau khi Showtime confirm, gọi lại với idempotency key để đọc kết quả cũ; không confirm thêm lần hai.

### Phương án ngăn deadlock và double sell

Tất cả write operations cùng showtime dùng thứ tự lock nhất quán: khóa `showtime` theo id → expire active holds quá hạn → lock seat slots theo `seat_id` đã sort → verify couple pairs/availability → ghi hold hoặc allocation. Có unique partial index `(showtime_id, seat_id) WHERE status='active'` trên allocations. Ghế cặp được xử lý cùng một transaction; mọi tranh chấp trả `409 SEAT_UNAVAILABLE`.

## 5. Điều chưa thể tuyên bố hoàn thành

- Không có migration/runtime/test execution trong gói tài liệu. Chưa chứng minh race test hay latency/coverage.
- Cần thống nhất cụ thể TTL guest access token, retention, provider mock refund behavior và cách check-in/cancel concurrency nếu giảng viên có hướng dẫn chi tiết; các mục này **không** thay đổi D-05…D-18.
- Các endpoint nội bộ và schema là contract mục tiêu: owner phải xác nhận response, lifecycle và triển khai khớp trước merge.
