# Đồng bộ quyết định — 2026-11-18

**Trạng thái:** `ACCEPTED` / `ACCEPTED — REVISED` (D-04) theo xác nhận của nhóm. Dự án hiện ở giai đoạn **project scaffolding** (chưa triển khai logic nghiệp vụ).

| Nhóm quyết định | Tài liệu tác động |
|---|---|
| D-04 (`ACCEPTED — REVISED`), D-12, D-13, D-14, D-18 | ARCHITECTURE, DESIGN-REVIEW, ERD, DATABASE-IMPLEMENTATION, API-SPEC, CONTRACT-MATRIX, SECURITY, DEPLOYMENT, TEAM-PLAN, IMPLEMENTATION-BACKLOG, OpenAPI |
| D-05, D-06, D-15 | PRD, BUSINESS-RULES, USER-FLOWS, ERD, API-SPEC, TESTING, TEAM-PLAN, OpenAPI |
| D-07 | PRD, BUSINESS-RULES, USER-FLOWS, API-SPEC, TESTING, TEAM-PLAN, OpenAPI |
| D-08, D-09 | PRD, BUSINESS-RULES, USER-FLOWS, API-SPEC, SECURITY, TESTING, OpenAPI |
| D-10, D-11 | PRD, BUSINESS-RULES, USER-FLOWS, API-SPEC, TESTING, DEPLOYMENT, OpenAPI |

## Các điểm vẫn cần triển khai và xác minh ở giai đoạn code nghiệp vụ

1. Knex migrations thật trong 3 schema (`core`, `payment`, `notification`), cơ chế pair integrity (D-15) và lock order trong `core-service`.
2. Đặc tả OpenAPI cần được từng owner bổ sung chi tiết khi hiện thực hóa từng endpoint.
3. Workflow phối hợp giữa `core-service`, `payment-service` và `notification-service`: thanh toán thành công → xác nhận kết quả ở Core → cấp ghế & vé QR → gửi thông báo qua Notification Service; nếu ghế không thể xác nhận thì kích hoạt hoàn tiền (`refund_pending` → `refunded`).
4. Test thật concurrency giữ ghế, bảo mật webhook HMAC ở Payment Service, signed service JWT nội bộ, Redis shared rate limit và các boundary T-120m/T±30m.
5. Ghi lại tên 5 thành viên phê duyệt trên biên bản nhóm và cập nhật GitHub usernames vào `.github/CODEOWNERS`.

## Lịch sử cập nhật

- **Review v3 (18/11/2026):** Bổ sung `DESIGN-REVIEW.md`, `DATABASE-IMPLEMENTATION.md`, `CONTRACT-MATRIX.md`, `CONTRACT-TEST-CASES.md`, `IMPLEMENTATION-BACKLOG.md`, `openapi/internal-api.yaml`.
- **Refactor D-04 (`ACCEPTED — REVISED`, 18/11/2026):** Chuyển từ 5 Express services sang **3 Express services độc lập (`core-service`, `payment-service`, `notification-service`)** trên 1 PostgreSQL chia **3 schema (`core`, `payment`, `notification`)** nhằm bám sát cấu trúc Core / Payment / Notification của đề và giảm độ phức tạp giao dịch phân tán nội bộ.
