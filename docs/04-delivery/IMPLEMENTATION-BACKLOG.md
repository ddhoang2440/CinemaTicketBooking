# Implementation Backlog — 5 Thành viên × 32 giờ (160h trên Kiến trúc 3 Dịch vụ)

**Với mỗi task:** có PR, test, OpenAPI diff và reviewer từ module phụ thuộc.

| TV | ID | Service / Module | Task | Giờ | Dependency / Acceptance |
|---|---|---|---|---:|---|
| TV1 | ID-01 | `core-service` (`auth`, `users`, `roles`) | Auth DB migrations trong schema `core` + seed roles | 5 | Repeatable migrations |
| TV1 | ID-02 | `core-service` (`auth`) | Register/verify/login/refresh/logout + gọi `notification-service` gửi mail verify | 9 | Cookie rotation, hashed tokens |
| TV1 | ID-03 | Shared / `core-service` | Customer JWT + RBAC + signed service JWT (D-13) + Redis rate limit (D-14) | 8 | Auth errors, audience/scope |
| TV1 | ID-04 | `frontend` (`features/auth`) | Auth & profile UI | 6 | React flow tested |
| TV1 | ID-05 | All 3 Services | Security tests + API contracts | 4 | SEC-01..15, CT-14..16 |
| TV2 | CA-01 | `core-service` (`movies`, `cinemas`, `auditoriums`, `seats`) | Catalog & `seat_pairs` migrations trong schema `core` | 7 | Ghế đôi đúng 2 seat IDs (D-15) |
| TV2 | CA-02 | `core-service` (`movies`, `cinemas`, `auditoriums`) | CRUD/search/filter API | 8 | Pagination & role scope |
| TV2 | CA-03 | `frontend` (`features/movies`, `features/cinemas`) | Movie/cinema/admin UI | 11 | Responsive states |
| TV2 | CA-04 | `core-service` (`seats`) | Seat map query service + tests | 6 | Couple pair integrity |
| TV3 | SH-01 | `core-service` (`showtimes`, `pricing`, `seat-holds`) | Showtime/price/hold/allocation migrations trong schema `core` | 7 | Buffer 15m (D-11) + active partial unique indexes (D-12) |
| TV3 | SH-02 | `core-service` (`showtimes`, `pricing`) | Showtime CRUD, server quote VND, seat state API | 6 | Overlap validation |
| TV3 | SH-03 | `core-service` (`seat-holds`) | Atomic hold (300s, max 8) / expire / confirm / release | 11 | Race & idempotency tests (CT-01..06) |
| TV3 | SH-04 | `frontend` (`features/showtimes`, `features/seats`) | Showtime & interactive seat map UI | 5 | 5-min countdown |
| TV3 | SH-05 | `core-service` | Concurrency & contract tests | 3 | 20 parallel holds |
| TV4 | BO-01 | `core-service` + `payment-service` | Booking/concession/ticket migrations (`core`) + Payment/webhook/refund migrations (`payment`) | 5 | `BIGINT` VND (D-18), state machines |
| TV4 | BO-02 | `core-service` (`bookings`, `concessions`, `tickets`) | Booking creation, guest token hash (D-08), ≥120m cancel (D-07), QR ticket issuance | 6 | Max 8 seats, atomic couple cancel |
| TV4 | BO-03 | `payment-service` (`payments`, `webhooks`, `refunds`) | Mock payment intent, HMAC webhook (D-09), callback sang Core & late-payment refund compensation | 9 | CT-07, CT-08, CT-21 |
| TV4 | BO-04 | `frontend` (`features/bookings`, `features/payments`, `features/tickets`) | Checkout, mock payment, booking history & QR ticket UI | 8 | QR shown after seat allocation confirmed |
| TV4 | BO-05 | `core-service` + `payment-service` | Integration tests cho booking/payment/refund | 4 | Idempotency & compensation paths |
| TV5 | OP-01 | `core-service` (`checkins`, `reports`) | QR check-in (`[-30,+30]m`, `UNIQUE(ticket_id)`) & revenue/occupancy reports | 8 | CT-11, CT-12 |
| TV5 | OP-02 | `notification-service` (`email`, `templates`, `delivery`) | Internal notification API, templates & delivery status tracking trong schema `notification` | 6 | Non-blocking retry (CT-22) |
| TV5 | OP-03 | `frontend` (`features/checkins`, `features/reports`, `features/notifications`) | Staff check-in scanner & Manager report UI | 6 | Role-scoped views |
| TV5 | OP-04 | Infrastructure / DevOps | Docker Compose (3 services + Postgres + Redis + Web), CI, seed (`20/12/2026 19:30 VN`), Playwright E2E | 12 | All healthchecks green, E2E evidence |
