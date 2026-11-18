# PRD — Cinema Ticket Booking System

**Trạng thái:** Draft đã đồng bộ kiến trúc 3 dịch vụ (`D-04 ACCEPTED — REVISED`). **Nguồn:** 6 ảnh đề bài. **Ngôn ngữ:** Tiếng Việt; tên bảng/cột/endpoint và JSON tiếng Anh.

## 1. Bài toán và mục tiêu

Khách hàng xem phim, suất chiếu, ghế còn trống, mua vé và nhận vé QR trực tuyến. Nhân viên rạp thực hiện check-in. Quản lý rạp quản lý lịch chiếu, giá, báo cáo; admin quản trị cụm rạp, tài khoản và quyền.

**Mục tiêu chất lượng [ĐỀ BÀI]:** SPA React, backend REST SOA (**Core Service, Payment Service, Notification Service**), tài liệu OpenAPI 3.1, bảo mật theo mục 3.1, Docker Compose, CI, coverage `backend/` (`services/api` theo đề) ≥60%, API danh sách <200ms và trạng thái ghế <100ms (theo điều kiện đo thống nhất), bundle ban đầu ≤250KB gzip, Lighthouse desktop ≥80.

## 2. Personas và RBAC

| Vai trò | Chức năng được phép | Giới hạn |
|---|---|---|
| Guest | Xem phim, lịch chiếu, tìm kiếm; giữ vé/đặt vé không cần tài khoản nếu cung cấp thông tin hợp lệ | Không xem đơn người khác; chỉ truy xuất vé guest bằng token/đường link xác minh an toàn |
| Customer | Guest + quản lý hồ sơ, lịch sử đặt vé và đơn của mình | Không tự đổi giá, trạng thái hoặc quyền |
| Staff | Quét QR, xem danh sách khán giả suất chiếu **được phân công** | Không thay đổi giá, quyền, dữ liệu rạp khác |
| Manager | Quản lý phim/suất chiếu/giá/nhân viên (theo phạm vi rạp) và báo cáo rạp | Không truy xuất rạp khác; không cấp quyền hệ thống |
| Admin | Quản trị toàn hệ thống, cụm rạp/phòng/nhân sự, cấu hình vận hành | Vẫn cần audit và xác thực |

> Quyền cụ thể được kiểm tra ở backend theo `role + cinema_scope`; frontend chỉ ẩn điều khiển, không quyết định quyền.

## 3. In scope — yêu cầu chức năng (5 thành viên trên 3 dịch vụ)

| ID | Epic | Service & Module | User story và acceptance cơ bản | Ưu tiên | Chủ sở hữu |
|---|---|---|---|---|---|
| FR-01 | Catalog | Core (`movies`) | Khách xem danh sách phim, phim chi tiết, tìm kiếm autocomplete, lọc rạp/ngày/2D-3D-IMAX/khung giờ | Must | TV2 |
| FR-02 | Identity | Core (`auth`, `users`, `roles`) | Đăng ký, xác thực email, đăng nhập, quản lý hồ sơ; JWT và refresh token | Must | TV1 |
| FR-03 | Cinema | Core (`cinemas`, `auditoriums`, `seats`) | Admin quản lý cụm rạp/phòng chiếu/sơ đồ ghế, phân loại thường/VIP/ghế đôi | Must | TV2 |
| FR-04 | Showtime | Core (`showtimes`, `pricing`) | Manager tạo lịch chiếu; kiểm tra trùng phòng + buffer 15 phút; mở bán/đổi trạng thái suất | Must | TV3 |
| FR-05 | Seat | Core (`seat-holds`) | Khách thấy trạng thái ghế gần hiện thời và chọn ghế; backend chống trùng giữ/đặt | Must | TV3 |
| FR-06 | Checkout | Core (`bookings`, `concessions`) | Khách chọn bắp nước, nhập thông tin, xác nhận giá và tạo booking | Must | TV4 |
| FR-07 | Payment | Payment (`payments`, `webhooks`, `refunds`) | Thanh toán qua dịch vụ giả lập, webhook có kiểm chữ ký HMAC, trạng thái nhất quán | Must | TV4 |
| FR-08 | E-ticket & Email | Core (`tickets`) + Notification (`email`) | Booking thanh toán thành công và phân bổ ghế xong sinh QR, gửi email qua Notification Service và trang xem vé | Must | TV4 / TV5 |
| FR-09 | Cancellation | Core (`bookings`) + Payment (`refunds`) | Khách hủy vé trước suất ≥120 phút khi chưa check-in; hoàn tiền giả lập qua Payment Service | Must | TV4 |
| FR-10 | Check-in | Core (`checkins`) | Staff quét QR một lần trong khung [-30,+30] phút và ghi nhận trạng thái vé | Must | TV5 |
| FR-11 | Reports | Core (`reports`) | Manager xem doanh thu, vé bán, tỉ lệ lấp đầy theo rạp/phim/suất | Must | TV5 |
| FR-12 | RBAC & Security | All 3 Services | Phân quyền route/hành động/tài nguyên, signed service JWT nội bộ, Redis rate limit, validate và logging | Must | TV1 + mọi TV |
| FR-13 | Data/DevOps | All 3 Services | Knex migrations+seed trên 3 schema (`core`, `payment`, `notification`), OpenAPI, Docker Compose, CI | Must | TV5 + mọi TV |

## 4. Dòng nghiệp vụ chuẩn

1. Admin tạo cụm rạp → phòng → sơ đồ ghế → tài khoản/quyền trên Core Service.
2. Manager cấu hình phim/suất chiếu/giá → mở bán trên Core Service.
3. Guest/Customer tìm phim → chọn suất → xem ghế → giữ ghế (Core) → chọn bắp nước → tạo booking (Core) → khởi tạo & xác nhận thanh toán (Payment Service) → xác nhận phân bổ ghế & cấp vé QR (Core) → gửi email xác nhận (Notification Service).
4. Staff quét QR → xác minh vé → check-in một lần trên Core Service.
5. Manager xem thống kê và trạng thái suất từ `on_sale` → `started` → `completed`.

## 5. Ngoài phạm vi MVP

WebSocket thời gian thực, AI/LLM, Google Login, gợi ý phim cá nhân hóa, ví/điểm thưởng, đối soát cổng thanh toán thật, đa ngôn ngữ, ứng dụng mobile native.

## 6. Phi chức năng

| ID | Yêu cầu | Cách xác minh |
|---|---|---|
| NFR-01 | SPA React render client; không dùng Next.js/React Router thay toàn framework | Architecture review |
| NFR-02 | REST JSON, OpenAPI 3.1, mọi endpoint/module có schema và ví dụ | Swagger validation |
| NFR-03 | `backend/` (`services/api` theo đề) coverage ≥60%; CI tests trên mọi PR | Coverage artifact |
| NFR-04 | API list <200ms; seat state <100ms | autocannon theo kịch bản |
| NFR-05 | Bundle ban đầu ≤250KB gzip, poster lazy, placeholder giữ kích thước | Build analyzer |
| NFR-06 | Lighthouse desktop Performance ≥80 | Báo cáo Lighthouse |
| NFR-07 | Responsive 360/768/1280px, mobile-first, WCAG AA hướng tới | Visual/keyboard/a11y checks |
| NFR-08 | Form tiếng Việt rõ ràng, loading/empty/error/success, truy cập bàn phím, alt text | QA checklist |
| NFR-09 | Thời gian hiển thị Asia/Ho_Chi_Minh, tiền VNĐ (integer) | Unit/E2E timezone tests |
| NFR-10 | Mỗi dịch vụ (`core`, `payment`, `notification`) có healthcheck, structured logs và request ID | Docker/integration |
| NFR-11 | Không commit `.env`/secret, có `.env.example`; bảo vệ JWT/refresh/hmac | Security checklist |
| NFR-12 | `docker compose up` chạy toàn hệ thống, có dữ liệu demo | Reproducibility test |

## 7. Quyết định nghiệp vụ & kiến trúc đã chốt (18/11/2026)

- **D-04 (`ACCEPTED — REVISED`):** 3 Express services độc lập (`core-service`, `payment-service`, `notification-service`), 1 PostgreSQL chia 3 schema (`core`, `payment`, `notification`).
- **D-12/D-13/D-14/D-18:** Core Service là nguồn sự thật ghế; internal signed service JWT; rate limit Redis dùng chung; integer VND và UTC.
- **D-10/D-11:** QR check-in -30 đến +30 phút; buffer phòng 15 phút.
- **D-05/D-06/D-07/D-08/D-09/D-15:** Hold 5 phút (300s) / tối đa 8 seat ID vật lý / hủy trước ≥120 phút + chưa check-in / guest token hash / mock webhook HMAC tại Payment Service / ghế đôi bắt buộc theo cặp.
