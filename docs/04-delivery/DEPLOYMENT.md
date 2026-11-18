# DEPLOYMENT — Docker Compose, CI/CD, môi trường và bàn giao (3-Service Architecture)

## 1. Yêu cầu từ đề

- Chỉ `docker compose up` có thể khởi động toàn bộ hệ thống cùng PostgreSQL 17, Redis 7, 3 dịch vụ backend và frontend trong local demo.
- Tất cả service có healthcheck (`/health`), log cấu trúc và request ID (`x-request-id`).
- Git/GitHub, README hướng dẫn cài đặt, biến môi trường, tài khoản demo theo từng vai trò.
- CI GitHub Actions chạy toàn bộ kiểm tra mỗi Pull Request.
- Dữ liệu mẫu tiếng Việt, có lịch chiếu **20/12/2026 19:30 Asia/Ho_Chi_Minh** (`2026-12-20T12:30:00Z`).

## 2. Docker Compose Services (`D-04 ACCEPTED — REVISED`)

```text
postgres:17-alpine     PostgreSQL 17 với 3 schemas: core, payment, notification (port 5432)
redis:7-alpine         Shared Redis rate limiter (port 6379)
core-api               Express 5 Core Service (port 4001, schema: core)
payment-api            Express 5 Payment Service (port 4002, schema: payment)
notification-api       Express 5 Notification Service (port 4003, schema: notification)
web                    React 19 SPA served via Nginx (port 8080 -> 80)
```

## 3. Biến môi trường chuẩn (`.env.example`)

```dotenv
NODE_ENV=development
TZ=Asia/Ho_Chi_Minh
POSTGRES_USER=cinema_user
POSTGRES_PASSWORD=cinema_dev_password_placeholder
POSTGRES_DB=cinema
POSTGRES_PORT=5432
DATABASE_URL=postgresql://cinema_user:cinema_dev_password_placeholder@localhost:5432/cinema
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379

CORE_SERVICE_PORT=4001
PAYMENT_SERVICE_PORT=4002
NOTIFICATION_SERVICE_PORT=4003

CORE_SERVICE_URL=http://localhost:4001
PAYMENT_SERVICE_URL=http://localhost:4002
NOTIFICATION_SERVICE_URL=http://localhost:4003

FRONTEND_PORT=8080
WEB_ORIGIN=http://localhost:5173
VITE_API_BASE_URL=http://localhost:4001/api/v1

JWT_ISSUER=cinema-api
JWT_AUDIENCE=cinema-web
JWT_SECRET=replace_with_at_least_32_byte_random_secret_placeholder
REFRESH_COOKIE_NAME=cinema_refresh

SERVICE_JWT_ISSUER=cinema-internal
SERVICE_JWT_AUDIENCE=cinema-services
SERVICE_JWT_SECRET=replace_with_at_least_32_byte_internal_service_secret

PAYMENT_WEBHOOK_SECRET=replace_with_at_least_32_byte_webhook_hmac_secret

SEAT_HOLD_TTL_SECONDS=300
MAX_BOOKING_SEATS=8
CANCELLATION_CUTOFF_MINUTES=120
CHECKIN_EARLY_MINUTES=30
CHECKIN_LATE_MINUTES=30
SHOWTIME_BUFFER_MINUTES=15
```

## 4. Khởi chạy và kiểm tra Health

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
node infrastructure/scripts/check-health.mjs
```

Health endpoints mặc định:
- Core Service: `http://localhost:4001/health`
- Payment Service: `http://localhost:4002/health`
- Notification Service: `http://localhost:4003/health`
- Frontend SPA: `http://localhost:8080`

## 5. Dấu kiểm triển khai ACCEPTED

- [x] **D-04 (`ACCEPTED — REVISED`):** 3 Express processes độc lập (`core-service`, `payment-service`, `notification-service`), 1 PostgreSQL 17 chia 3 schema (`core`, `payment`, `notification`); Redis 7 running cho shared rate limiting.
- [ ] Nội bộ chỉ dùng signed service JWT (`D-13`); webhook chỉ dùng HMAC (`D-09`) tại `payment-service`.
- [ ] Seed có ghế đôi gồm hai `seat_id` (`D-15`) và suất chiếu `20/12/2026 19:30 Asia/Ho_Chi_Minh` (`D-16`).
- [x] Config giữ ghế `300s`, max `8` ghế, cancellation `120m`, check-in `[-30,+30]m`, buffer `15m`.
- [x] Money integer VND + timestamps UTC (`D-18`); `.env.example` không chứa khóa thật.
