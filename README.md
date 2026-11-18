# Cinema Ticket Booking System

> Bộ tài liệu thiết kế và triển khai cho đồ án web đặt vé xem phim — nhóm **5 thành viên**, tổng **160 giờ** (dự kiến 32 giờ/người). Phiên bản tài liệu `v1.1-revised-3-services`, ngày 18/11/2026.

## 1. Phạm vi

Ứng dụng SPA React phục vụ khách vãng lai, khách có tài khoản, nhân viên rạp, quản lý rạp và quản trị viên. Hỗ trợ tra cứu phim, suất chiếu, lựa chọn/giữ ghế, đặt vé, chọn bắp nước, thanh toán qua dịch vụ thanh toán giả lập, xuất vé QR qua email, hủy theo chính sách, soát vé và thống kê.

## 2. Nguồn và cách đọc

- **[ĐỀ BÀI]**: yêu cầu rút từ **6 ảnh** người dùng cung cấp trong hội thoại ngày 18/11/2026.
- **[ĐỀ XUẤT]**: quyết định kỹ thuật/nghiệp vụ nhằm biến đề bài thành giải pháp triển khai; cần cả nhóm duyệt trước khi khóa hợp đồng.
- **[CẦN CHỐT]**: đề chưa quy định đủ chi tiết; không được xem là yêu cầu gốc.

Đây là bộ hồ sơ thiết kế và khung dự án (scaffolding), **chưa phải bằng chứng đã hoàn thành tính năng nghiệp vụ**. Không báo cáo các chỉ tiêu hiệu năng/coverage nghiệp vụ là đã đạt nếu chưa đo.

## 3. Stack theo đề

- Frontend: **React 19**, **Vite**, TypeScript, React Router 6 (Data Router), TanStack Query 5, Redux Toolkit; HTML5/CSS3, Tailwind CSS 4, shadcn/ui; react-hook-form + Zod.
- Backend: **Node.js 22 LTS**, **Express 5** (3 dịch vụ độc lập: `core-service`, `payment-service`, `notification-service`); REST, OpenAPI **3.1**, Zod, Swagger UI; JWT, refresh token.
- Data: **PostgreSQL 17** (chia 3 schema: `core`, `payment`, `notification`), **Knex 3**; **Redis** dùng chung cho rate limiting (D-14).
- Tooling: pino/pino-http, Nodemailer, qrcode, Mailpit, Vitest, Supertest, React Testing Library, Playwright; Git/GitHub, Docker, Docker Compose, GitHub Actions.
- Deploy: Vercel (SPA), Render/DigitalOcean hoặc nền tảng phù hợp cho API, PostgreSQL managed khi vận hành cloud; demo tại local phải chạy bằng `docker compose up`.

## 4. Hướng dẫn chạy (Monorepo Scaffolding: `frontend/` & `backend/`)

```bash
# 1. Cài đặt dependencies cho toàn bộ npm workspaces
npm install

# 2. Kiểm tra lint, typecheck, smoke test và build
npm run lint
npm run typecheck
npm run test
npm run build

# 3. Chạy từng dịch vụ ở chế độ development
npm run dev:core           # http://localhost:4001/health (schema: core)
npm run dev:payment        # http://localhost:4002/health (schema: payment)
npm run dev:notification   # http://localhost:4003/health (schema: notification)
npm run dev:frontend       # http://localhost:5173

# 4. Chạy toàn bộ stack bằng Docker Compose (PostgreSQL 17 + Redis 7 + 3 Backend Services + Frontend)
cp .env.example .env
docker compose up -d --build
node infrastructure/scripts/check-health.mjs
```

**Lưu ý:** Hiện tại dự án ở giai đoạn **khởi tạo khung monorepo (project scaffolding)** với `frontend/` (React 19 + Vite) và 3 dịch vụ Express 5 độc lập trong `backend/` (`core-service`, `payment-service`, `notification-service`). Chưa triển khai logic nghiệp vụ, bảng dữ liệu nghiệp vụ hay dữ liệu mẫu.

## 5. Danh mục tài liệu

| File | Mục đích |
|---|---|
| `docs/01-requirements/PRD.md` | Chức năng, phạm vi, acceptance criteria |
| `docs/01-requirements/USER-FLOWS.md` | Luồng theo từng vai trò, ngoại lệ |
| `docs/01-requirements/BUSINESS-RULES.md` | Ràng buộc đặt vé, giữ ghế, thanh toán |
| `docs/02-architecture/ARCHITECTURE.md` | SOA 3 dịch vụ, tương tác service, dữ liệu, giao dịch |
| `docs/02-architecture/ERD.md` | Mô hình dữ liệu 3 schema (`core`, `payment`, `notification`), quan hệ, ràng buộc |
| `docs/02-architecture/API-SPEC.md` | Quy ước REST và bảng endpoint |
| `openapi/cinema-api.yaml` | Hợp đồng OpenAPI 3.1 public API |
| `openapi/internal-api.yaml` | Hợp đồng OpenAPI 3.1 internal service-to-service API |
| `docs/03-quality/SECURITY.md` | Threat model và test bảo mật |
| `docs/03-quality/TESTING.md` | Test plan, coverage, performance |
| `docs/04-delivery/DEPLOYMENT.md` | Docker/CI/CD, vận hành, rollback |
| `docs/04-delivery/TEAM-PLAN.md` | Phân công 5 thành viên trên 3 dịch vụ, phụ thuộc, 4 tuần, checklist |
| `docs/diagrams/*.mmd` | Mermaid flow/architecture/ERD |
| `docs/DECISIONS.md` | Quyết định đã chốt (bao gồm D-04 `ACCEPTED — REVISED`) |

## 6. Điều kiện đạt yêu cầu đề (traceability)

| Đầu mục đề | Nơi mô tả |
|---|---|
| 5 vai trò và quyền | PRD, SECURITY |
| Tìm phim / chọn suất / đặt ghế / QR | PRD, USER-FLOWS, BUSINESS-RULES |
| SOA + REST + OpenAPI | ARCHITECTURE, API-SPEC, YAML |
| JWT + refresh + webhook HMAC | SECURITY, API-SPEC |
| SSR chỉ trang chia sẻ (nếu dùng) | ARCHITECTURE |
| Docker Compose + CI + cloud | DEPLOYMENT |
| Test + 60% `backend/` (`services/api` theo đề) | TESTING |
| Hiệu năng, UI, accessibility | TESTING, PRD |
| Báo cáo, demo và phân công | TEAM-PLAN, DEPLOYMENT |

## 7. Định nghĩa hoàn thành

Một chức năng chỉ đạt **Done** khi: có code frontend/backend/Knex migration (nếu áp dụng), quyền truy cập đúng, validate dữ liệu, OpenAPI cập nhật, test xanh, review PR, demo bằng Docker, có bằng chứng/log trong báo cáo.

## Các quyết định nhóm đã chốt & cập nhật (18/11/2026)

13 ADR tại `docs/DECISIONS.md` đã được xác nhận, trong đó **D-04 được cập nhật sang `ACCEPTED — REVISED`**: **3 Express services độc lập (`core-service`, `payment-service`, `notification-service`) + 1 PostgreSQL chia 3 schema (`core`, `payment`, `notification`)** (thay thế thiết kế 5 services trước đó nhằm bám sát cấu trúc Core / Payment / Notification của đề và giảm độ phức tạp hệ phân tán không cần thiết). Các quyết định D-05 đến D-18 giữ nguyên: hold 5 phút (300s), tối đa 8 ghế vật lý, hủy ≥120 phút và chưa check-in, guest token (lưu hash), mock payment HMAC, check-in [-30,+30] phút, buffer 15 phút, Core Service giữ seat truth bằng PG locks/constraints, internal signed service JWT, Redis rate-limit chung, ghế đôi hai ID bán theo cặp, integer VND và UTC.

## Contract-ready v3 — supplementary documents
- `docs/02-architecture/DESIGN-REVIEW.md`: critical gaps, owners and solutions (updated for 3-service architecture).
- `docs/02-architecture/DATABASE-IMPLEMENTATION.md`: SQL constraint and transaction blueprint across `core`, `payment`, and `notification` schemas.
- `docs/02-architecture/CONTRACT-MATRIX.md`: internal/public contracts and error handling between Core, Payment, and Notification services.
- `docs/03-quality/CONTRACT-TEST-CASES.md`: concurrency/security acceptance tests.
- `docs/04-delivery/IMPLEMENTATION-BACKLOG.md`: 160h ownership plan across 5 team members.
- `openapi/cinema-api.yaml` + `openapi/internal-api.yaml`: contract drafts; no live business implementation yet.
