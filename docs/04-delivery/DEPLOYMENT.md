# DEPLOYMENT — Docker Compose, CI/CD, môi trường và bàn giao

## 1. Yêu cầu từ đề

- Chỉ `docker compose up` có thể khởi động hệ thống cùng DB và dịch vụ liên quan trong local demo.
- Tất cả service có healthcheck, log cấu trúc và request ID.
- Git/GitHub, README hướng dẫn cài đặt, biến môi trường, tài khoản demo theo từng vai trò.
- CI GitHub Actions chạy toàn bộ tests mỗi Pull Request; frontend/backend triển khai cloud (Vercel, Render hoặc DigitalOcean được gợi ý trong đề).
- Dữ liệu mẫu tiếng Việt, có lịch chiếu **20/12/2026 19:30 Asia/Ho_Chi_Minh**.

## 2. Môi trường

| Environment | Host | DB | Secrets | Mục đích |
|---|---|---|---|---|
| local | Docker Compose | PostgreSQL 17 container | `.env` local (gitignored) | Code/demo |
| CI | GitHub runner + Compose/services | DB test riêng | GitHub Secrets, placeholder | Build/test |
| staging | Cloud tùy chọn | Managed PostgreSQL | Secret manager | Demo online |

## 3. Compose services dự kiến

```text
postgres:17           database (healthcheck pg_isready)
redis                 shared rate limiter (healthcheck ping)
mailpit               SMTP/email mock + inbox web
identity-api          Express 5 + healthcheck
catalog-api           Express 5 + healthcheck
showtime-api          Express 5 + healthcheck
booking-api           Express 5 + healthcheck
operations-api        Express 5 + healthcheck
web                   React SPA production build served static
proxy (optional)      Single-origin API ingress
```

**Quyết định ACCEPTED D-04:** Giữ 5 Express processes như đã chốt; không gộp process khi triển khai mặc định. Đề tài liệu này **không bao gồm** file Docker Compose hoạt động vì chưa có code; chỉ là hợp đồng để TV5 triển khai.

## 4. Env vars cần chuẩn bị

```dotenv
NODE_ENV=development
TZ=Asia/Ho_Chi_Minh
DATABASE_URL=postgresql://USER:PASSWORD@postgres:5432/cinema
JWT_ISSUER=cinema-api
JWT_AUDIENCE=cinema-web
JWT_PRIVATE_KEY_PATH=/run/secrets/jwt_private_key
JWT_PUBLIC_KEY_PATH=/run/secrets/jwt_public_key
REFRESH_COOKIE_NAME=cinema_refresh
WEB_ORIGIN=http://localhost:5173
MAIL_HOST=mailpit
MAIL_PORT=1025
PAYMENT_WEBHOOK_SECRET=REPLACE_WITH_32_PLUS_BYTE_RANDOM_VALUE
SERVICE_JWT_ISSUER=cinema-internal
SERVICE_JWT_AUDIENCE=cinema-services
SERVICE_JWT_PRIVATE_KEY_PATH=/run/secrets/service_jwt_private_key
SERVICE_JWT_PUBLIC_KEY_PATH=/run/secrets/service_jwt_public_key
REDIS_URL=redis://redis:6379
SEAT_HOLD_TTL_SECONDS=300
MAX_BOOKING_SEATS=8
CANCELLATION_CUTOFF_MINUTES=120
CHECKIN_EARLY_MINUTES=30
CHECKIN_LATE_MINUTES=30
SHOWTIME_BUFFER_MINUTES=15
```

Mẫu này là **hướng dẫn biến**, không phải `.env` thực hay credentials hợp lệ. Không commit secret thật; bảo đảm email/login/demo cài từ seed script và README môi trường demo riêng.

## 5. Startup, migration, seed

1. Compose `postgres` healthy → chạy **one-shot migration job** (Knex latest) với quyền migrate; fail thì không mở traffic.
2. Seed idempotent: phim/rạp/phòng/ghế/giá, user theo vai trò, mock paid/unpaid booking, QR.
3. API services chờ DB ready, startup health checks.
4. Frontend đọc `VITE_API_BASE_URL` (không bao giờ chứa secret). Tất cả biến `VITE_` sẽ được bundle phía client.
5. Chạy Playwright smoke sau khi hệ thống ready.

## 6. Pipeline GitHub Actions (thiết kế)

On: `pull_request` vào `develop/main`, `push` vào `main`.

Stages:
1. Checkout, setup Node.js 22, cache npm.
2. Install with lockfile, lint, format, build.
3. OpenAPI lint/validate.
4. Start PostgreSQL test, migrate, seed test.
5. Unit/API integration with coverage threshold.
6. Start Compose test → Playwright smoke.
7. Upload test reports and coverage.
8. On protected main + approved environment: deploy (manual approval hoặc CD phù hợp).

## 7. Deploy cloud

- SPA build → Vercel (route fallback `index.html` cho SPA), API → Render/DigitalOcean, DB managed Postgres; cấu hình custom domains, TLS, CORS và cookie domain theo nguồn thực tế.
- Cron tasks: expire seat holds (optimistic cleanup), showtime status, reconcile payments; cron **không** là cơ chế duy nhất quyết định hold expiry.
- Health/readiness monitoring, error log retention theo chính sách nhóm; backup database định kỳ nếu có môi trường cloud.
- Secrets rotation khi lộ; deploy rollback code version nếu migration backward-compatible; schema changes expand/contract.

## 8. Demo và báo cáo bắt buộc

**Video demo tối đa 15 phút**, 5 luồng trọng yếu (gợi ý: admin thiết lập, khách tìm/chọn giữ ghế, checkout + mock payment + QR, staff soát vé, manager báo cáo), chia thời lượng giữa thành viên.

**Báo cáo PDF** gồm:
1. Giới thiệu, phân tích yêu cầu (user story, use case).
2. Kiến trúc: sơ đồ SOA, phân tích lựa chọn, so sánh CSR với SSR và lý do không dùng SSR toàn app.
3. Thiết kế API: query ước tính, hợp đồng OpenAPI, thiết kế DB/ERD, ràng buộc, schema.
4. Kiến trúc frontend: route, components, luồng dữ liệu Redux/Query, state.
5. Bảo mật (bảng mục 3.1) và **bằng chứng test thực tế**.
6. Kiểm thử (unit, integration, component, E2E), coverage đạt/chưa đạt, hiệu năng autocannon, Lighthouse.
7. Docker/CI/deployment, hướng dẫn tái tạo local.
8. Quy trình làm việc: phân công, thống kê commits/PRs, khó khăn và bài học.

## 9. Release checklist

- [ ] Fresh clone + `.env` + `docker compose up --build` chạy được.
- [ ] Có migrations/seed, ngày giờ dữ liệu mẫu đúng.
- [ ] 5 demo roles và quyền đúng.
- [ ] OpenAPI khớp API chạy thật.
- [ ] Không secret trong repo/log.
- [ ] Test/coverage/perf có bằng chứng, không ghi số liệu bịa.
- [ ] Cloud URL và README chạy được; video và PDF hoàn tất.


## Dấu kiểm triển khai ACCEPTED

- [ ] 5 API Express processes, schema PostgreSQL tách theo ownership; Redis running và dùng chung cho rate limits.
- [ ] Nội bộ chỉ dùng signed service JWT; webhook chỉ dùng HMAC đúng mock payment provider.
- [ ] Seed có ghế đôi gồm hai seat ID, đủ constraint và ghế thường/VIP.
- [ ] Config giữ ghế 300s, max 8, cancellation 120m, check-in [-30,+30]m, buffer 15m.
- [ ] Money integer VND + timestamps UTC; tài liệu `.env.example` không chứa khóa thật.
