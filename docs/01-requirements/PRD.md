# PRD — Cinema Ticket Booking System

**Trạng thái:** Draft để nhóm duyệt. **Nguồn:** 6 ảnh đề bài. **Ngôn ngữ:** Tiếng Việt; tên bảng/cột/endpoint và JSON tiếng Anh.

## 1. Bài toán và mục tiêu

Khách hàng xem phim, suất chiếu, ghế còn trống, mua vé và nhận vé QR trực tuyến. Nhân viên rạp thực hiện check-in. Quản lý rạp quản lý lịch chiếu, giá, báo cáo; admin quản trị cụm rạp, tài khoản và quyền.

**Mục tiêu chất lượng [ĐỀ BÀI]:** SPA React, backend REST SOA, tài liệu OpenAPI 3.1, bảo mật theo mục 3.1, Docker Compose, CI, coverage `services/api` ≥60%, API danh sách <200ms và trạng thái ghế <100ms (theo điều kiện đo thống nhất), bundle ban đầu ≤250KB gzip, Lighthouse desktop ≥80.

## 2. Personas và RBAC

| Vai trò | Chức năng được phép | Giới hạn |
|---|---|---|
| Guest | Xem phim, lịch chiếu, tìm kiếm; giữ vé/đặt vé không cần tài khoản nếu cung cấp thông tin hợp lệ | Không xem đơn người khác; chỉ truy xuất vé guest bằng token/đường link xác minh an toàn |
| Customer | Guest + quản lý hồ sơ, lịch sử đặt vé và đơn của mình | Không tự đổi giá, trạng thái hoặc quyền |
| Staff | Quét QR, xem danh sách khán giả suất chiếu **được phân công** | Không thay đổi giá, quyền, dữ liệu rạp khác |
| Manager | Quản lý phim/suất chiếu/giá/nhân viên (theo phạm vi rạp) và báo cáo rạp | Không truy xuất rạp khác; không cấp quyền hệ thống |
| Admin | Quản trị toàn hệ thống, cụm rạp/phòng/nhân sự, cấu hình vận hành | Vẫn cần audit và xác thực |

> [ĐỀ XUẤT] Quyền cụ thể cần được kiểm tra ở backend theo `role + cinema_scope`; frontend chỉ ẩn điều khiển, không quyết định quyền.

## 3. In scope — yêu cầu chức năng

| ID | Epic | User story và acceptance cơ bản | Ưu tiên | Chủ sở hữu |
|---|---|---|---|---|
| FR-01 | Catalog | Khách xem danh sách phim, phim chi tiết, tìm kiếm autocomplete, lọc rạp/ngày/2D-3D-IMAX/khung giờ | Must | TV2 |
| FR-02 | Identity | Đăng ký, xác thực email, đăng nhập, quản lý hồ sơ; JWT và refresh token | Must | TV1 |
| FR-03 | Cinema | Admin quản lý cụm rạp/phòng chiếu/sơ đồ ghế, phân loại thường/VIP/ghế đôi | Must | TV2 |
| FR-04 | Showtime | Manager tạo lịch chiếu; kiểm tra trùng phòng và thời gian; mở bán/đổi trạng thái suất | Must | TV3 |
| FR-05 | Seat | Khách thấy trạng thái ghế gần hiện thời và chọn ghế; backend chống trùng giữ/đặt | Must | TV3 |
| FR-06 | Checkout | Khách chọn bắp nước, nhập thông tin, xác nhận giá và tạo booking | Must | TV4 |
| FR-07 | Payment | Thanh toán qua dịch vụ giả lập, webhook có kiểm chữ ký, trạng thái nhất quán | Must | TV4 |
| FR-08 | E-ticket | Booking thanh toán thành công sinh QR, email và trang xem vé | Must | TV4 |
| FR-09 | Cancellation | Khách hủy vé theo chính sách; không hoàn tiền tùy ý | Must | TV4 |
| FR-10 | Check-in | Staff quét QR một lần và ghi nhận trạng thái vé | Must | TV5 |
| FR-11 | Reports | Manager xem doanh thu, vé bán, tỉ lệ lấp đầy theo rạp/phim/suất | Must | TV5 |
| FR-12 | RBAC & security | Phân quyền cả route, hành động và tài nguyên; validate và logging | Must | TV1 + mọi TV |
| FR-13 | Data/DevOps | Knex migrations+seed, OpenAPI, Docker Compose, CI; có dữ liệu mẫu | Must | TV5 + mọi TV |

### Acceptance chi tiết (mẫu chuẩn)

- **FR-01:** Query rỗng trả danh sách phân trang; tìm kiếm không phân biệt hoa/thường; lọc theo ngày Việt Nam và định dạng; autocomplete có debounce phía client; danh sách không trả phim ẩn.
- **FR-04:** Trùng lịch cùng auditorium bị từ chối với 409; lịch chiếu gắn phim, phòng, thời gian bắt đầu, kết thúc, định dạng, tình trạng bán.
- **FR-05:** Một cặp `(showtime_id, seat_id)` chỉ được bán **một lần**; hai phiên giữ cùng ghế đồng thời chỉ một thành công; ghế giữ tự hết hạn; client hiển thị lại khi API báo conflict.
- **FR-07:** Callback lặp không tạo trùng đơn/vé; thanh toán thành công sau khi giữ ghế hết hạn phải được xử lý theo cơ chế bồi hoàn/đối soát được nhóm thống nhất; không tự cấp vé nếu không thể xác nhận ghế.
- **FR-08:** QR không chứa PII hoặc secrets; tải vé phải được phép (chủ sở hữu hoặc guest verification); email dùng Mailpit trong demo.
- **FR-10:** Cùng một vé không check-in thành công hai lần; Staff chỉ thấy suất thuộc rạp được phân công.
- **FR-11:** Chỉ tính doanh thu đã thanh toán, xử lý rõ hủy/hoàn tiền; số ghế bán không tính ghế đang giữ.

## 4. Dòng nghiệp vụ chuẩn

1. Admin tạo cụm rạp → phòng → sơ đồ ghế → tài khoản/quyền.
2. Manager cấu hình phim/suất chiếu/giá → mở bán.
3. Guest/Customer tìm phim → chọn suất → xem ghế → giữ ghế → chọn bắp nước → nhập thông tin → thanh toán → nhận QR.
4. Staff quét QR → xác minh vé → check-in một lần.
5. Manager xem thống kê và trạng thái suất từ `on_sale` → `started` → `completed`.

## 5. Ngoài phạm vi MVP [ĐỀ XUẤT]

WebSocket thời gian thực (đề ghi có thể nâng cao), AI/LLM, Google Login, gợi ý phim cá nhân hóa, ví/điểm thưởng, đối soát cổng thanh toán thật, đa ngôn ngữ, ứng dụng mobile native. Chỉ triển khai nếu hoàn thành MVP và được cả nhóm duyệt.

## 6. Phi chức năng

| ID | Yêu cầu | Cách xác minh |
|---|---|---|
| NFR-01 | SPA React render client; không dùng Next.js/React Router thay toàn framework; SSR chỉ trang chia sẻ nếu có | Architecture review |
| NFR-02 | REST JSON, OpenAPI 3.1, mọi endpoint/module có schema và ví dụ | Swagger validation |
| NFR-03 | `services/api` coverage ≥60%; CI tests trên mọi PR | Coverage artifact |
| NFR-04 | API list <200ms; seat state <100ms | autocannon theo kịch bản, môi trường xác định |
| NFR-05 | Bundle ban đầu ≤250KB gzip, poster lazy, placeholder giữ kích thước | Build analyzer |
| NFR-06 | Lighthouse desktop Performance ≥80 | Báo cáo Lighthouse |
| NFR-07 | Responsive 360/768/1280px, mobile-first, WCAG AA hướng tới | Visual/keyboard/a11y checks |
| NFR-08 | Form tiếng Việt rõ ràng, loading/empty/error/success, truy cập bàn phím, alt text | QA checklist |
| NFR-09 | Thời gian hiển thị Asia/Ho_Chi_Minh, tiền VNĐ | Unit/E2E timezone tests |
| NFR-10 | Mỗi dịch vụ có healthcheck, structured logs và request ID | Docker/integration |
| NFR-11 | Không commit `.env`/secret, có `.env.example`; bảo vệ JWT/refresh/hmac | Security checklist |
| NFR-12 | `docker compose up` chạy toàn hệ thống, có dữ liệu demo | Reproducibility test |

## 7. Dữ liệu mẫu bắt buộc

- Bộ phim/rạp/phòng/ghế bằng tiếng Việt, hỗ trợ tìm kiếm và lọc.
- Có ít nhất một lịch chiếu hợp lệ **20/12/2026 lúc 19:30 (Asia/Ho_Chi_Minh)** [ĐỀ BÀI].
- Tài khoản demo cho 5 vai trò; credential chỉ cung cấp trong tài liệu demo an toàn, không để password thực trong repository.
- Bao gồm trường hợp ghế trống/đang giữ/đã bán; giao dịch thành công/thất bại; QR đã/ chưa check-in.

## 8. Các quyết định cần chốt

- **[ACCEPTED D-05/D-06/D-15]** Giữ ghế tối đa **5 phút**; tối đa **8 seat ID vật lý**/booking; ghế đôi là 2 ID phải đặt cùng nhau.
- **[ACCEPTED D-07]** Hủy nếu còn **ít nhất 120 phút** trước suất và **chưa check-in**, hoàn tiền bằng mock refund.
- **[ACCEPTED D-08]** Guest đặt vé bằng email + guest access token ngẫu nhiên, có scope và bảo vệ hash.
- **[ACCEPTED D-09]** Payment mock adapter trong Booking service, callback webhook có HMAC, timestamp và idempotency.

## 9. Tiêu chí bàn giao

Repository có lịch sử commit/PR, README, OpenAPI nhất quán, Docker Compose, CI, báo cáo PDF (vai trò, SOA so với CSR/SSR, kiến trúc API, FE, bảo mật, test, performance, quy trình làm việc), video demo ≤15 phút và minh chứng các chỉ tiêu được đo thực tế.


## Quyết định nghiệp vụ đã chốt (2026-11-18)

**Trạng thái:** `[ACCEPTED 2026-11-18]` theo `docs/DECISIONS.md`. Đây là quy tắc thiết kế đã chốt, chưa phải bằng chứng đã chạy code.

- **D-04/D-12/D-13/D-14/D-18:** 5 Express services, 1 PostgreSQL chia schema; Showtime là nguồn sự thật ghế; internal signed service JWT; rate limit Redis; integer VND và UTC.
- **D-10/D-11:** QR check-in -30 đến +30 phút; buffer phòng 15 phút.
- **D-05/D-06/D-07/D-08/D-09/D-15:** 5 phút/8 seat ID/hủy trước ≥120 phút + chưa check-in/guest token/mock webhook HMAC/ghế đôi bắt buộc theo cặp.
