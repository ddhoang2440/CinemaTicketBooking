# Implementation Backlog v3 — 5 người × 32 giờ (160h)

**Với mỗi task:** có PR, test, OpenAPI diff và reviewer từ module phụ thuộc. Ước lượng có thể thay đổi sau spike kỹ thuật; 160h là budget, không phải cam kết code đã xong.

| TV | ID | Task | Giờ | Dependency / Acceptance |
|---|---|---|---:|---|
| TV1 | ID-01 | Auth DB + Knex + seed roles | 5 | Own schema, migrations repeatable |
| TV1 | ID-02 | Register/verify/login/refresh | 9 | Cookie, rotation, hashed tokens |
| TV1 | ID-03 | JWT verification + RBAC + service JWT | 8 | Auth errors, audience/scope |
| TV1 | ID-04 | Auth & profile UI | 6 | React flow tested |
| TV1 | ID-05 | Tests + API contracts | 4 | Critical security cases |
| TV2 | CA-01 | Movies/cinemas/auditoriums/seats schema | 7 | Seat pairs exactly 2 |
| TV2 | CA-02 | CRUD/search API | 8 | Filter/pagination/permissions |
| TV2 | CA-03 | Movie/cinema/admin UI | 11 | Responsive states |
| TV2 | CA-04 | Internal seat-map + tests | 6 | Couple pair mapping |
| TV3 | SH-01 | Showtime/hold/allocation migration | 7 | Buffer + active indexes |
| TV3 | SH-02 | Showtime CRUD, quote, seat state | 6 | 15m overlap validation |
| TV3 | SH-03 | Atomic hold/expire/confirm/release | 11 | Race/idempotency tests |
| TV3 | SH-04 | Showtime/seat map UI | 5 | 5-min countdown |
| TV3 | SH-05 | Test + contract | 3 | CT-01…CT-06 |
| TV4 | BO-01 | Booking/payment/ticket schema | 5 | Money bigint, state machine |
| TV4 | BO-02 | Booking + guest access token | 6 | Max 8 seat IDs |
| TV4 | BO-03 | Mock payment HMAC + refund reconciliation | 9 | CT-07/08/21 |
| TV4 | BO-04 | Checkout/ticket/history UI | 8 | QR issued after confirm |
| TV4 | BO-05 | Test + contract | 4 | Refund/cancel paths |
| TV5 | OP-01 | Check-in/summary API | 8 | T-30…T+30; unique ticket |
| TV5 | OP-02 | Check-in/report UI | 7 | Role-scoped |
| TV5 | OP-03 | Docker Compose + CI + seed | 9 | 5 service health checks + Redis |
| TV5 | OP-04 | E2E/performance & docs delivery | 8 | Evidence, 20/12 seed, demo |

**Critical path:** TV2 seat map → TV3 hold/confirm → TV4 payment/ticket → TV5 check-in. TV1 JWT/service auth blocks all internal integration. **Không bắt đầu full integration trước khi OpenAPI v3 và migrations owners được review.**
