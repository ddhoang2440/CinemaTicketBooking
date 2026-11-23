# TESTING — Chiến lược kiểm thử và chất lượng (3-Service Architecture)

## 1. Yêu cầu gốc

- Unit: Vitest cho module, reducer/query logic, validation, giá và giữ ghế.
- API integration: Vitest + Supertest + **database thật riêng cho test** trên 3 services (`core-service`, `payment-service`, `notification-service`); tối thiểu mỗi endpoint chính có một happy path và một lỗi quyền/validation.
- Component: React Testing Library, ít nhất 2 component trọng tâm như form và seat map.
- E2E: Playwright chạy trên Docker Compose cho các luồng nghiệp vụ chính.
- Security: theo bảng mục 3.1 trong `SECURITY.md`, kết quả test đính kèm báo cáo.
- Coverage thư mục `backend/` (`services/api` theo đề) **ít nhất 60%**; CI chạy toàn bộ kiểm thử mỗi Pull Request.
- Hiệu năng: đo API bằng autocannon, UI bằng Lighthouse; kết quả thực tế ghi vào báo cáo, chưa công bố số liệu cho tới khi đo thật.

## 2. Test Pyramid và Ownership (5 Thành viên trên 3 Dịch vụ)

| Layer | Công cụ | Người chịu trách nhiệm | Phải có |
|---|---|---|---|
| Unit | Vitest | Mọi TV (TV1–TV5) | Validation, business rules, tính giá VND, kiểm tra cặp ghế đôi |
| API Integration | Vitest + Supertest + PostgreSQL | TV1–TV5 trên `core-service`; TV4 trên `payment-service`; TV5 trên `notification-service` | CRUD, auth/scope, transaction giữ/phân bổ ghế, webhook HMAC, hoàn tiền, gửi thông báo |
| Component | React Testing Library | Mọi TV | Form, seat map, loading/error/empty states |
| E2E | Playwright | TV5 điều phối, tất cả review | 5 business flows trên Docker Compose |
| Security | Vitest/Supertest + checklist | TV1 điều phối | SEC-01..15 |
| Load/Performance | autocannon, Lighthouse | TV5 + TV3 | endpoint SLA (`<200ms` list, `<100ms` seats), bundle `≤250KB` gzip |

## 3. Performance Measurement Protocol

- API `GET /api/v1/movies`, `/api/v1/showtimes` (list trên `core-service`): thời gian response **<200ms**.
- API `GET /api/v1/showtimes/{id}/seats` (seat state trên `core-service`): response **<100ms**.

```bash
npx autocannon -c 20 -d 30 http://localhost:4001/api/v1/movies
npx autocannon -c 20 -d 30 http://localhost:4001/api/v1/showtimes/SHOWTIME_ID/seats
```

## 4. Coverage Gate

**Ngưỡng:** statement/line coverage trong `backend/` (`core-service`, `payment-service`, `notification-service` — tương ứng `services/api` theo đề) đạt **≥60%**.

```bash
npm run test
npm run test:coverage
npm run test:e2e
```

### Migration integration tests (BO-01)

`bo01-migrations.integration.test.ts` (core-service) và `payment-migrations.integration.test.ts` (payment-service) chạy trên PostgreSQL thật. Đặt `BO01_TEST_DATABASE_URL` là URL của role có quyền CREATEDB (database bất kỳ), ví dụ `postgresql://cinema_user:...@localhost:5432/postgres`; mỗi suite tự tạo rồi xoá database riêng của nó. Không đặt biến này thì các suite này được skip, không fail.
Suite core cần toàn bộ migration của `core-service` (Auth, CA-01, SH-01, BO-01) áp dụng được trên database trống; nếu không, suite sẽ FAIL chứ không skip.
