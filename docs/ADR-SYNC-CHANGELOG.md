# Đồng bộ quyết định — 2026-11-18

**Trạng thái:** ACCEPTED theo xác nhận người đại diện nhóm. **Không** xác nhận code đã chạy.

| Nhóm quyết định | Tài liệu tác động |
|---|---|
| D-04, D-12, D-13, D-14, D-18 | ARCHITECTURE, ERD, API-SPEC, SECURITY, DEPLOYMENT, TEAM-PLAN, OpenAPI |
| D-05, D-06, D-15 | PRD, BUSINESS-RULES, USER-FLOWS, ERD, API-SPEC, TESTING, TEAM-PLAN, OpenAPI |
| D-07 | PRD, BUSINESS-RULES, USER-FLOWS, API-SPEC, TESTING, TEAM-PLAN, OpenAPI |
| D-08, D-09 | PRD, BUSINESS-RULES, USER-FLOWS, API-SPEC, SECURITY, TESTING, OpenAPI |
| D-10, D-11 | PRD, BUSINESS-RULES, USER-FLOWS, API-SPEC, TESTING, DEPLOYMENT, OpenAPI |

## Các điểm vẫn cần triển khai và xác minh

1. Knex migrations thật, cơ chế pair integrity, thao tác SQL + lock order giữa 5 Express services.
2. Đặc tả OpenAPI starter chưa bao phủ mọi endpoint; thêm request/response/schema/status cho từng operation.
3. Mock refund khi payment chưa thể hoàn hoặc refund pending; kiểm soát bất nhất khi xác nhận ghế và payment.
4. Test thật concurrency, bảo mật webhook, JWT nội bộ, Redis shared rate limit và các boundary T-120m/T±30m.
5. Ghi lại tên 5 người phê duyệt sau khi họp nếu môn học yêu cầu biên bản.

## Review v3 — 18/11/2026
- Added `DESIGN-REVIEW.md`, `DATABASE-IMPLEMENTATION.md`, `CONTRACT-MATRIX.md`, `CONTRACT-TEST-CASES.md`, `IMPLEMENTATION-BACKLOG.md`.
- Expanded public OpenAPI and introduced separately authenticated internal OpenAPI.
- Removed stale open choice for couple seating and 5-process topology; added explicit payment-late compensation and lock invariants.
- No source code, migrations or tests executed; contract/doc review only.
