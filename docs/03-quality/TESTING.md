# TESTING — Chiến lược kiểm thử và chất lượng

## 1. Yêu cầu gốc

- Unit: Vitest cho module, reducer/query logic, validation, giá và giữ ghế.
- API integration: Vitest + Supertest + **database thật riêng cho test**; tối thiểu mỗi endpoint chính có một happy path và một lỗi quyền/validation.
- Component: React Testing Library, ít nhất 2 component trọng tâm như form và seat map.
- E2E: Playwright chạy trên Docker Compose cho luồng ở mục 2.2.
- Security: theo bảng mục 3.1, kết quả test đính kèm báo cáo.
- Coverage thư mục `services/api` **ít nhất 60%**; CI chạy toàn bộ kiểm thử mỗi Pull Request.
- Hiệu năng: đo API bằng autocannon, UI bằng Lighthouse; kết quả thực tế ghi vào báo cáo, chưa có số liệu cho tới khi chạy.

## 2. Test pyramid và ownership

| Layer | Công cụ | Người chịu trách nhiệm | Phải có |
|---|---|---|---|
| Unit | Vitest | Mọi TV | Validation, business rules, service calculations |
| API integration | Vitest + Supertest + test PostgreSQL | Mọi TV | CRUD, auth/scope, transaction, errors |
| Component | React Testing Library | Mọi TV | Form, seat map, state handling |
| E2E | Playwright | TV5 điều phối, tất cả review | 5 business flows |
| Security | Vitest/Supertest + manual checklist | TV1 điều phối | SEC-01..15 |
| Load/performance | autocannon, Lighthouse | TV5 + TV3 | endpoint SLA, bundle, UI |

## 3. Ma trận test case chi tiết

| ID | Type | Scenario | Expected |
|---|---|---|---|
| UNIT-AUTH-01 | Unit | JWT invalid audience / expiry | Reject |
| INT-AUTH-01 | Integration | Register → verify → login → refresh → logout | Chuỗi hợp lệ, token cũ vô hiệu |
| INT-CATALOG-01 | Integration | Create movie, paginate, filter title | Kết quả và role đúng |
| INT-CINEMA-01 | Integration | Tạo phòng với seat duplicate | 409 |
| INT-SHOW-01 | Integration | Hai suất chồng lịch một phòng | 409 |
| UNIT-PRICE-01 | Unit | Giá thường/VIP/đôi, bắp nước | Total VND chính xác |
| CONC-SEAT-01 | Concurrency | 20 yêu cầu giữ cùng ghế đồng thời | Đúng 1 hold thành công |
| CONC-SEAT-02 | Concurrency | Giữ ghế khác nhau cùng suất | Không thất thoát, data consistent |
| INT-HOLD-01 | Integration | Hold TTL hết hạn | Mở ghế lại khi transaction mới, 410 với hold cũ |
| INT-PAY-01 | Integration | Webhook success hợp lệ và lặp | Một booking confirmed, không trùng QR |
| INT-PAY-02 | Integration | Webhook success đến sau hết hạn hold | Không phát vé, refund/review state |
| INT-CANCEL-01 | Integration | Hủy vé trước/sau cutoff | Chấp nhận/từ chối theo rule |
| E2E-CATALOG-01 | E2E | Search → filter → movie → showtime | Chọn đúng suất |
| E2E-BOOK-01 | E2E | Guest → hold → checkout → mock pay → QR email | Vé confirmed |
| E2E-CHECKIN-01 | E2E | Staff quét QR một lần rồi quét lại | Lần đầu OK, lần sau 409 |
| INT-REPORT-01 | Integration | Paid vs failed vs refunded report | Không tính failed, trừ refund |
| E2E-ADMIN-01 | E2E | Admin tạo rạp/phòng, manager tạo suất | Public thấy đúng suất |
| E2E-MOBILE-01 | E2E | Viewport 360px, keyboard, form error | Không overflow, usable |

## 4. Performance measurement protocol

**Chưa có benchmark!** Chỉ tiêu dưới đây là targets từ đề; phải ghi được cấu hình đo.

- API `GET /movies`, `/showtimes` (list): thời gian response **<200ms**.
- API `GET /showtimes/{id}/seats`: response **<100ms**.
- Chạy autocannon với môi trường cấu hình ổn định: CPU/RAM, PostgreSQL local/network, dataset số rạp/phim/ghế, số kết nối, `-c` concurrent users, `-d` duration, warm-up; nêu rõ metric dùng (mean/p95) vì đề không chỉ ra thống kê, đề xuất đo **p95**.
- Ví dụ (điều chỉnh URL/headers khi có code):

```bash
npx autocannon -c 20 -d 30 http://localhost:3000/api/v1/movies
npx autocannon -c 20 -d 30 http://localhost:3000/api/v1/showtimes/SHOWTIME_ID/seats
```

- Frontend: kiểm gzipped initial JS ≤250KB, ảnh poster lazy, route split, skeleton và stable image dimensions; Lighthouse Performance desktop ≥80.
- Responsive: thiết bị/viewport 360, 768, 1280 px; keyboard-only, aria/labels, alt, focus, contrast đủ WCAG AA.

## 5. Coverage gate

**Ngưỡng:** statement/branch/function/line trong `services/api` cần đo rõ; yêu cầu đề chỉ nêu "coverage ... ít nhất 60%". Nhóm đề xuất đặt coverage tổng lines/statements **≥60%**, theo dõi branches/functions để không che lỗ hổng. Loại generated/OpenAPI bundle nếu cần có ghi chú; không loại modules nghiệp vụ quan trọng khỏi báo cáo.

```bash
# Ví dụ lệnh sau khi scripts đã được định nghĩa:
npm run test:unit
npm run test:integration
npm run test:coverage
npm run test:e2e
```

## 6. CI gate và artifacts

PR → lint/typecheck (nếu TypeScript)/build → unit + integration test trên Postgres test → coverage → OpenAPI lint → Playwright smoke bằng Compose → report artifact. Test security và performance chuyên sâu có thể chạy job riêng, nhưng **không được nói CI đạt mọi test nếu job chưa chạy**.

Evidence lưu dưới `reports/qa/`: `coverage/`, `playwright/`, `autocannon/`, `lighthouse/`, `security-checklist.md`, cùng ngày, commit SHA, môi trường. Mỗi bug có ticket, owner, mức ưu tiên và link PR sửa.

## 7. Definition of Done cho một feature

- [ ] Requirement có ID; edge case/role scope rõ.
- [ ] API trong OpenAPI khớp implementation.
- [ ] Zod validation, business rule, error map, audit/log phù hợp.
- [ ] Unit + integration + component/e2e thích hợp xanh.
- [ ] Không lộ secret/PII; quyền resource được test.
- [ ] UI responsive, loading/error/empty/success.
- [ ] PR được reviewer khác duyệt; Docker demo hoạt động.


## Test cases bổ sung cho quyết định ACCEPTED

| ID | Kiểu | Thử nghiệm | Kỳ vọng |
|---|---|---|---|
| ADR-HOLD-05 | Integration | Hold hết hạn chính xác sau 300s server clock | Ghế được mở; hold cũ từ chối |
| ADR-MAX-06 | API | 8 ghế hợp lệ, 9 ghế không hợp lệ | 8 OK, 9 trả 422 |
| ADR-CANCEL-07 | Integration | Hủy lúc T-121m, T-120m, T-119m; ticket đã check-in | 121/120 được, 119/đã check-in bị từ chối; mock refund |
| ADR-GUEST-08 | Security | Guest thiếu token, đoán ID, thay email | Không xem được booking; token hash không lộ |
| ADR-HMAC-09 | Integration | Webhook ký đúng/sai và gửi lặp | Đúng xử lý 1 lần; sai 401 |
| ADR-CHECKIN-10 | Boundary | Quét tại T-31m,T-30m,T+30m,T+31m | Chỉ hai điểm giữa hợp lệ |
| ADR-BUFFER-11 | Integration | Phòng trùng giờ và cách 14m/15m | 14m 409; 15m OK |
| ADR-RACE-12 | Concurrency | 20 parallel holds/confirm vào cùng ghế | Một allocation active, không double-book |
| ADR-JWT-13 | Security | JWT nội bộ sai iss/aud/scope/expired | 401/403; đúng claim qua |
| ADR-REDIS-14 | Integration | 2 API instances đồng thời rate-limit | Dùng chung quota qua Redis |
| ADR-COUPLE-15 | Integration | Một nửa ghế đôi, cả cặp, cạnh tranh đồng thời, cancellation | Chỉ bán đủ cặp; 422 thiếu cặp; không bán lẻ |
| ADR-VND-18 | Unit/API | Large VND + timestamps UTC/Z | Không sai số float; timezone hiển thị đúng |

Không đánh dấu PASS trước khi chạy test thật và lưu evidence trong CI.
