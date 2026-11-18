# Cinema Ticket Booking System

> Bộ tài liệu thiết kế và triển khai cho đồ án web đặt vé xem phim — nhóm **5 thành viên**, tổng **160 giờ** (dự kiến 32 giờ/người). Phiên bản tài liệu `v1.0-draft`, ngày 18/11/2026.

## 1. Phạm vi

Ứng dụng SPA React phục vụ khách vãng lai, khách có tài khoản, nhân viên rạp, quản lý rạp và quản trị viên. Hỗ trợ tra cứu phim, suất chiếu, lựa chọn/giữ ghế, đặt vé, chọn bắp nước, thanh toán qua dịch vụ thanh toán giả lập, xuất vé QR qua email, hủy theo chính sách, soát vé và thống kê.

## 2. Nguồn và cách đọc

- **[ĐỀ BÀI]**: yêu cầu rút từ **6 ảnh** người dùng cung cấp trong hội thoại ngày 18/11/2026.
- **[ĐỀ XUẤT]**: quyết định kỹ thuật/nghiệp vụ nhằm biến đề bài thành giải pháp triển khai; cần cả nhóm duyệt trước khi khóa hợp đồng.
- **[CẦN CHỐT]**: đề chưa quy định đủ chi tiết; không được xem là yêu cầu gốc.

Đây là bộ hồ sơ thiết kế, **chưa phải bằng chứng đã code, test, deploy**. Không báo cáo các chỉ tiêu hiệu năng/coverage là đã đạt nếu chưa đo.

## 3. Stack theo đề

- Frontend: **React 19**, **Vite**, JS ES2023/JSX (có thể dùng TypeScript nếu nhóm thống nhất), React Router 6 (Data Router), TanStack Query 5, Redux Toolkit; HTML5/CSS3, Tailwind CSS 4, shadcn/ui; react-hook-form + Zod.
- Backend: **Node.js 22 LTS**, **Express 5**; REST, OpenAPI **3.1**, Zod + zod-to-openapi, Swagger UI; JWT, refresh token.
- Data: **PostgreSQL 17**, **Knex 3**; Redis chỉ tùy chọn khi có phê duyệt, **không bắt buộc**.
- Tooling: pino/pino-http, Nodemailer, qrcode, Mailpit, Vitest, Supertest, React Testing Library, Playwright; Git/GitHub, Docker, Docker Compose, GitHub Actions.
- Deploy: Vercel (SPA), Render/DigitalOcean hoặc nền tảng phù hợp cho API, PostgreSQL managed khi vận hành cloud; demo tại local phải chạy bằng `docker compose up`.

## 4. Hướng dẫn chạy (sau khi triển khai code)

```bash
cp .env.example .env
# Điền biến môi trường phù hợp; không commit secrets
docker compose up --build
# URL, tài khoản demo và migration script được bổ sung khi code hoàn tất
```

**Lưu ý:** Gói này chỉ chứa `docs/` và `openapi/`, không có source code, Dockerfile hay môi trường chạy. Lệnh trên là hợp đồng vận hành dự kiến, không thể chạy riêng từ gói tài liệu.

## 5. Danh mục tài liệu

| File | Mục đích |
|---|---|
| `docs/01-requirements/PRD.md` | Chức năng, phạm vi, acceptance criteria |
| `docs/01-requirements/USER-FLOWS.md` | Luồng theo từng vai trò, ngoại lệ |
| `docs/01-requirements/BUSINESS-RULES.md` | Ràng buộc đặt vé, giữ ghế, thanh toán |
| `docs/02-architecture/ARCHITECTURE.md` | SOA, tương tác service, dữ liệu, giao dịch |
| `docs/02-architecture/ERD.md` | Mô hình dữ liệu, quan hệ, ràng buộc |
| `docs/02-architecture/API-SPEC.md` | Quy ước REST và bảng endpoint |
| `openapi/cinema-api.yaml` | Hợp đồng OpenAPI 3.1 ban đầu |
| `docs/03-quality/SECURITY.md` | Threat model và test bảo mật |
| `docs/03-quality/TESTING.md` | Test plan, coverage, performance |
| `docs/04-delivery/DEPLOYMENT.md` | Docker/CI/CD, vận hành, rollback |
| `docs/04-delivery/TEAM-PLAN.md` | Phân công, phụ thuộc, 4 tuần, checklist |
| `docs/diagrams/*.mmd` | Mermaid flow/architecture/ERD |
| `docs/DECISIONS.md` | Quyết định đã đề xuất và điểm cần chốt |

## 6. Điều kiện đạt yêu cầu đề (traceability)

| Đầu mục đề | Nơi mô tả |
|---|---|
| 5 vai trò và quyền | PRD, SECURITY |
| Tìm phim / chọn suất / đặt ghế / QR | PRD, USER-FLOWS, BUSINESS-RULES |
| SOA + REST + OpenAPI | ARCHITECTURE, API-SPEC, YAML |
| JWT + refresh + webhook HMAC | SECURITY, API-SPEC |
| SSR chỉ trang chia sẻ (nếu dùng) | ARCHITECTURE |
| Docker Compose + CI + cloud | DEPLOYMENT |
| Test + 60% `services/api` | TESTING |
| Hiệu năng, UI, accessibility | TESTING, PRD |
| Báo cáo, demo và phân công | TEAM-PLAN, DEPLOYMENT |

## 7. Định nghĩa hoàn thành

Một chức năng chỉ đạt **Done** khi: có code frontend/backend/Knex migration (nếu áp dụng), quyền truy cập đúng, validate dữ liệu, OpenAPI cập nhật, test xanh, review PR, demo bằng Docker, có bằng chứng/log trong báo cáo.


## Các quyết định nhóm đã chốt (18/11/2026)

13 ADR tại `docs/DECISIONS.md` đã chuyển sang `ACCEPTED`: 5 Express services + 1 PostgreSQL chia schema, hold 5 phút, 8 ghế, hủy ≥120 phút và chưa check-in, guest token, mock payment HMAC, check-in [-30,+30] phút, buffer 15 phút, Showtime giữ seat truth bằng PG locks/constraints, internal signed service JWT, Redis rate-limit chung, ghế đôi hai ID bán theo cặp, integer VND và UTC.

Các file này là **đặc tả** (chưa phải sản phẩm đã code/test); giữ OpenAPI starter và mở rộng khi triển khai.

## Contract-ready v3 — supplementary documents
- `docs/02-architecture/DESIGN-REVIEW.md`: critical gaps, owners and solutions.
- `docs/02-architecture/DATABASE-IMPLEMENTATION.md`: SQL constraint and transaction blueprint.
- `docs/02-architecture/CONTRACT-MATRIX.md`: internal/public contracts and error handling.
- `docs/03-quality/CONTRACT-TEST-CASES.md`: concurrency/security acceptance tests.
- `docs/04-delivery/IMPLEMENTATION-BACKLOG.md`: 160h ownership plan.
- `openapi/cinema-api.yaml` + `openapi/internal-api.yaml`: contract drafts; no live implementation.
