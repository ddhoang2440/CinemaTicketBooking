# TEAM PLAN — Phân công 5 thành viên / 160 giờ (Kiến trúc 3 Dịch vụ)

**Hình thức:** 5 thành viên (`TV1`–`TV5`) làm việc full-stack theo module nghiệp vụ trên nền **3 dịch vụ Express 5 độc lập (`core-service`, `payment-service`, `notification-service`)** và 1 ứng dụng React SPA (`frontend/`). Không ánh xạ cứng số lượng dịch vụ (3) với số lượng thành viên (5). **Dự toán:** 32 giờ/người, tổng 160 giờ.

## 1. Ownership và phân bổ giờ

| TV | Phạm vi sở hữu (Backend Service/Modules + Frontend Features) | Phân bổ chi tiết (giờ) | Tổng |
|---|---|---|---:|
| **TV1** | **Core Service** (`auth`, `users`, `roles`) + Shared Auth/Service-JWT/Rate-limit + **Frontend** (`features/auth`, `lib/auth`) | Nền tảng 5, DB 4, BE 9, FE 7, Test 5, tích hợp 2 | 32 |
| **TV2** | **Core Service** (`movies`, `cinemas`, `auditoriums`, `seats`) + **Frontend** (`features/movies`, `features/cinemas`) | Phân tích 2, DB 5, BE 9, FE 10, Test 4, tích hợp 2 | 32 |
| **TV3** | **Core Service** (`showtimes`, `pricing`, `seat-holds`) + **Frontend** (`features/showtimes`, `features/seats`) | Phân tích 3, DB 5, BE 11, FE 7, Test 4, tích hợp 2 | 32 |
| **TV4** | **Core Service** (`bookings`, `concessions`, `tickets`) + **Payment Service** (`payments`, `webhooks`, `refunds`) + **Frontend** (`features/bookings`, `features/payments`, `features/tickets`) | Phân tích 3, DB 4, BE 11, FE 8, Test 4, tích hợp 2 | 32 |
| **TV5** | **Core Service** (`checkins`, `reports`) + **Notification Service** (`email`, `templates`, `delivery`) + **Frontend** (`features/checkins`, `features/reports`, `features/notifications`) + **DevOps** | Phân tích 2, DB 2, BE 7, FE 6, Test 5, DevOps 8, tích hợp 2 | 32 |
| **Cả nhóm** | | | **160** |

## 2. Deliverable từng thành viên

| Owner | Database Schema & Tables | Backend Modules & Services | Frontend Features | Kiểm thử & Tài liệu |
|---|---|---|---|---|
| **TV1** | `core`: `users`, `roles`, `user_roles`, `refresh_sessions`, `email_verifications` | `core-service/src/modules/{auth,users,roles}`, middleware RBAC, signed service JWT (D-13), Redis rate limit (D-14) | `frontend/src/features/auth/`, `frontend/src/lib/auth/` | JWT, refresh rotation, service JWT, IDOR; OpenAPI |
| **TV2** | `core`: `movies`, `cinemas`, `auditoriums`, `seat_pairs`, `seats` | `core-service/src/modules/{movies,cinemas,auditoriums,seats}` (D-15 couple seat pairs) | `frontend/src/features/{movies,cinemas}/` | Catalog filters, CRUD role, couple seat pair validation; OpenAPI |
| **TV3** | `core`: `showtimes`, `ticket_prices`, `seat_hold_groups`, `seat_holds`, `seat_allocations` | `core-service/src/modules/{showtimes,pricing,seat-holds}` (D-05 300s hold, D-06 max 8, D-11 15m buffer, D-12 PG locks) | `frontend/src/features/{showtimes,seats}/` | 20 concurrent holds, overlap/buffer, hold expiry; OpenAPI |
| **TV4** | `core`: `bookings`, `booking_seats`, `concessions`, `booking_concessions`, `tickets`; `payment`: `payments`, `payment_events`, `refunds` | `core-service/src/modules/{bookings,concessions,tickets}` + `payment-service/src/modules/{payments,webhooks,refunds}` (D-07, D-08, D-09) | `frontend/src/features/{bookings,payments,tickets}/` | Webhook HMAC/replay/idempotency, late-payment refund compensation, cutoff 120m; OpenAPI |
| **TV5** | `core`: `ticket_checkins`, `audit_logs`; `notification`: `notification_templates`, `notification_deliveries` | `core-service/src/modules/{checkins,reports}` + `notification-service/src/modules/{email,templates,delivery}` (D-10) | `frontend/src/features/{checkins,reports,notifications}/` | Check-in window [-30,+30]m, Notification resilience, Playwright E2E, Docker Compose, CI |

## 3. Timeline 4 tuần

| Tuần | TV1 | TV2 | TV3 | TV4 | TV5 | Milestone |
|---|---|---|---|---|---|---|
| W1 | Auth schema (`core`), JWT, service JWT, Redis rate limit | Catalog & seat pairs schema (`core`) + sample UI | Showtime, pricing & hold schema (`core`) | Booking schema (`core`) + Payment schema (`payment`) | Check-in (`core`) + Notification (`notification`) + Docker/CI | Kiến trúc 3 dịch vụ, OpenAPI và DB migrations được duyệt |
| W2 | Auth endpoints + screens | CRUD movies/cinemas/seats | Showtimes, seat state, atomic holds | Checkout, booking + Payment intent | Check-in scaffold + Notification send API | Khách tìm phim/chọn suất/giữ ghế |
| W3 | RBAC scope enforcement | Tích hợp seat map với Showtime | Confirm allocation & race tests | HMAC webhook, refund compensation & QR tickets | Check-in [-30,+30]m, reports, email templates & Playwright | E2E đặt vé → thanh toán → QR email → soát vé |
| W4 | Security evidence | Responsive/catalog QA | Load/concurrency evidence | Payment/refund edge cases | Deploy, CI, report/demo | Fresh-clone Docker demo + báo cáo PDF & video |

## 4. Git và quy trình PR

- Branch: `main` protected, `develop` integration, `feature/tvN-domain-description`; không push thẳng `main`.
- `.github/CODEOWNERS` phân vùng rõ theo `backend/core-service/src/modules/<module>/`, `backend/payment-service/`, `backend/notification-service/` và `frontend/src/features/<feature>/`.
