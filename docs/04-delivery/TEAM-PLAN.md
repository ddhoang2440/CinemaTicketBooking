# TEAM PLAN — Phân công 5 thành viên / 160 giờ

**Hình thức:** module full-stack; mỗi người sở hữu UI, backend, DB, API, test module của mình. **Dự toán:** 32 giờ/người, 4 tuần × 8 giờ/người/tuần (không phải số giờ bắt buộc từng người trong đề).

## 1. Ownership và phân bổ giờ

| TV | Module | Phân bổ chi tiết | Tổng |
|---|---|---|---:|
| TV1 | Identity & Access | Nền tảng 5, DB 4, BE 9, FE 7, Test 5, tích hợp 2 | 32 |
| TV2 | Movie & Cinema | Phân tích 2, DB 5, BE 9, FE 10, Test 4, tích hợp 2 | 32 |
| TV3 | Showtime & Seat | Phân tích 3, DB 5, BE 11, FE 7, Test 4, tích hợp 2 | 32 |
| TV4 | Booking & Payment | Phân tích 3, DB 4, BE 11, FE 8, Test 4, tích hợp 2 | 32 |
| TV5 | Operations & Reporting | Phân tích 2, DB 2, BE 7, FE 6, Test 5, DevOps 8, tích hợp 2 | 32 |
| **Cả nhóm** | | | **160** |

**Rủi ro phân bổ:** TV3/TV4 có rủi ro tích hợp cao, TV5 bị DevOps phân tán. Cần giữ buffer 10–15% trong **từng** block giờ hoặc cắt feature cộng điểm; không âm thầm tăng tổng giờ báo cáo.

## 2. Deliverable từng thành viên

| Owner | Database | Backend/API | Frontend | Kiểm thử & tài liệu |
|---|---|---|---|---|
| TV1 | users, roles, sessions, verification | auth/register/login/refresh/logout, users, RBAC | Auth, profile, user admin | JWT, refresh reuse, IDOR; OpenAPI + README |
| TV2 | movies, cinemas, auditoriums, seats | catalog CRUD, search, filters, seat map base | Home, movies, detail, cinema admin | Catalog filters, CRUD role; OpenAPI |
| TV3 | showtimes, prices, seat holds, allocations | showtimes CRUD, availability/holds/confirm | Showtime list, interactive seat map/countdown | 20 concurrent holds, overlap/expiry; OpenAPI |
| TV4 | bookings, items, payments, tickets | booking/payment/mock webhook/QR | Checkout, mock pay, booking history, e-ticket | Idempotency/replay/expiry; OpenAPI |
| TV5 | checkins, audit event (nếu cần) | QR verification, checkin, reports | Staff scanner, Manager reporting | E2E + docker + CI + perf; deployment docs |

## 3. Timeline tuần

| Tuần | TV1 | TV2 | TV3 | TV4 | TV5 | Milestone |
|---|---|---|---|---|---|---|
| W1 | Auth schema, JWT, RBAC skeleton | Catalog schema + sample UI | Showtime schema, hold design | Booking/payment state design | Docker skeleton, CI workflow | Kiến trúc, API contract và DB review được duyệt |
| W2 | Auth endpoints + screens | CRUD catalog/cinema, search | Showtimes, seat map, holds | Checkout + booking/mock payment | Checkin scaffold, CI tests | Khách tìm phim/chọn suất/giữ ghế |
| W3 | Scope enforcement + review | Integrate showtime & UI | Confirm allocation and races | Signed webhook + ticket QR | Check-in + reports + Playwright | E2E đặt vé → QR → soát vé |
| W4 | Security evidence | Responsive/catalog QA | Load/concurrency evidence | Payment edge cases | Deploy, CI, report/demo | Fresh-clone Docker demo + tài liệu/bằng chứng |

## 4. Critical path / dependency

1. W1 day 1–2: thống nhất `movieId`, `cinemaId`, `auditoriumId`, `seatId`, `showtimeId`, `holdGroupId`, `bookingId`, `ticketId`, auth identity.
2. W1 day 3: TV2 cung cấp seat-map contract → TV3 dùng mock responses tạm.
3. W1 day 4: TV3 công bố `POST /seat-holds`, `/verify`, `/confirm` → TV4 viết stub client trước khi API có thật.
4. W2: TV1 công bố roles/claims và middleware → tất cả service tích hợp xác thực.
5. W3: TV4 công bố verify-ticket internal route → TV5 tích hợp QR check-in.
6. W4: Freeze breaking API changes, ưu tiên test/demo và fix P0/P1.

## 5. Git và quy trình PR

- Branch: `main` protected, `develop` integration, `feature/tvN-domain-description`; không push thẳng `main`.
- PR nhỏ, có ticket/requirement ID, screenshot UI khi áp dụng, test evidence, migration note, OpenAPI diff, reviewer từ **người khác**.
- `CODEOWNERS` khuyến nghị chia theo `features/`, `services/api/<module>/`; PR đổi public contract cần người gọi API review.
- Họp ngắn 10–15 phút ít nhất 2 lần/tuần: tiến độ, blockers, contract changes; ghi quyết định vào `DECISIONS.md`.
- Seed dùng ID ổn định hoặc lookup logic, giữ việc seed idempotent; không sửa migration đã được đồng đội áp dụng mà không có kế hoạch.

## 6. RACI cho điểm giao module

| Giao diện | Responsible | Accountable | Consulted |
|---|---|---|---|
| Auth JWT/RBAC contract | TV1 | TV1 | TV2–TV5 |
| Auditorium/seat model | TV2 | TV2 | TV3 |
| Hold/confirm/allocation | TV3 | TV3 | TV4 |
| Payment/webhook/ticket | TV4 | TV4 | TV3, TV5 |
| QR checkin/report data | TV5 | TV5 | TV4 |
| CI & Docker | TV5 | TV5 | Tất cả |
| End-to-end acceptance | Tất cả | Nhóm trưởng (cần chỉ định) | Tất cả |

## 7. Đánh giá đóng góp công bằng

Không chỉ dựa trên số commit. Mỗi thành viên nộp: links PR, test cases đã thêm, module walkthrough, issue xử lý, tài liệu và phần demo. Yêu cầu mỗi người review tối thiểu 2 PR của người khác [ĐỀ XUẤT]. Báo cáo giờ thực tế so với 32h dự kiến; tránh khai giờ khi không có bằng chứng.

## 8. Exit criteria theo tuần

- W1: Có PR kiến trúc/API/database, repo build, CI skeleton.
- W2: 5 module có màn hình/API khung và ít nhất một happy flow tích hợp.
- W3: E2E booking/check-in; có test concurrent seat và replay webhook.
- W4: Test/security/perf evidence, release notes, video ≤15 phút, PDF, Docker demo.


## Quyết định đã chốt — tác động công việc

- **TV1:** D-13 signed service JWT (issuance/verification contract), D-08 guest-token security phối hợp TV4, D-14 shared Redis rate-limiter framework.
- **TV2:** D-15 schema ghế đôi gồm 2 `seat_id` + `couple_pair_id`; công bố API đọc couple pair để TV3 sử dụng.
- **TV3:** D-05 hold 300s, D-06 max 8, D-11 buffer 15m, D-12 lock/unique, D-15 cặp ghế atomic.
- **TV4:** D-07 cutoff hủy ≥120m, mock refund; D-08 guest token; D-09 HMAC webhook + compensation; phối hợp confirm allocation TV3.
- **TV5:** D-10 check-in [-30,+30], D-14 Redis trong Compose/CI, test concurrency E2E; mọi TV kiểm thử module mình.
- **Chung:** D-04 năm Express processes, một PostgreSQL chia schema; D-18 integer VND và UTC.
- **Nghiệm thu:** ACCEPTED là thiết kế đã duyệt; mỗi TV phải gửi PR + test evidence trước khi ghi DONE.
