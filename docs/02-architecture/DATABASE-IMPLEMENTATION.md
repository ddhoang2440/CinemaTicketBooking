# Database Implementation Blueprint — PostgreSQL 17 + Knex 3

> **Thiết kế để triển khai, chưa phải migrations đã chạy.** Từ D-04/D-12/D-15/D-18 đã ACCEPTED. Cần áp dụng qua Knex migration, chạy và kiểm thử trên PostgreSQL 17.

## 1. Phân quyền schema

```sql
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS showtime;
CREATE SCHEMA IF NOT EXISTS booking;
CREATE SCHEMA IF NOT EXISTS operations;
-- Production: mỗi service dùng DB role riêng và chỉ có CRUD schema do mình sở hữu.
-- Không cấp USAGE/SELECT trực tiếp schema khác cho các service role.
```

## 2. Catalog: model ghế đôi

```sql
CREATE TABLE catalog.seat_pairs (
  id uuid PRIMARY KEY,
  auditorium_id uuid NOT NULL REFERENCES catalog.auditoriums(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, auditorium_id)
);
-- catalog.seats có auditorium_id và couple_pair_id nullable như trong ERD.
-- Hai ghế cùng auditorium, seat_type = 'couple', pair id giống nhau.
-- Đúng 2 thành viên của pair: enforced tại service transaction
-- bằng khóa seat_pairs row + trigger DEFERRABLE (nếu muốn DB-level).
CREATE UNIQUE INDEX IF NOT EXISTS idx_seat_pair_position
  ON catalog.seats(auditorium_id, row_label, seat_number);
```

**Quy tắc:** Không tạo cặp có 1/3 seat ở trạng thái đã công bố. Mutation seat pairs sau khi có suất đã bán phải bị chặn hoặc tạo phiên bản seat map. Booking count dùng seat ID vật lý; cặp tính 2/8.

## 3. Showtime: hold + allocation concurrency

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_hold_active
  ON showtime.seat_holds(showtime_id, seat_id)
  WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_allocation_active
  ON showtime.seat_allocations(showtime_id, seat_id)
  WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_hold_idempotency
  ON showtime.seat_hold_groups(owner_ref, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

**Cảnh báo SQL:** `WHERE expires_at > now()` không được dùng trong partial unique index vì `now()` không immutable. Index theo `status='active'`, quy trình transaction đánh dấu các hold đã hết hạn trước khi thử hold mới.

```text
BEGIN
SELECT id FROM showtime.showtimes WHERE id=:showtimeId FOR UPDATE;
UPDATE showtime.seat_holds SET status='expired' WHERE showtime_id=:showtimeId
  AND status='active' AND expires_at <= transaction_timestamp();
-- SELECT current allocated and held rows for requested seatIds;
-- verify unique, same auditorium, all couple pair members and <=8 physical seats;
-- INSERT hold_group, each hold row, idempotency key;
COMMIT
```

**Race test:** mở đồng thời >=20 clients giành cùng ghế hoặc ghế cặp, đảm bảo tối đa 1 hold active/cặp và 1 allocation active/seat. Repeat idempotency key với cùng payload trả cùng hold; khác payload trả 409.

## 4. Không chồng suất cùng phòng với buffer 15 phút

Lựa chọn kỹ thuật đề xuất là GiST exclusion constraint trên khoảng thời gian đã cộng buffer (cần `btree_gist`).

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- Nếu showtimes có starts_at, ends_at là timestamptz:
ALTER TABLE showtime.showtimes
  ADD CONSTRAINT showtime_no_room_overlap
  EXCLUDE USING gist (
    auditorium_id WITH =,
    tstzrange(starts_at, ends_at + interval '15 minutes', '[)') WITH &&
  ) WHERE (state IN ('draft','on_sale','sales_paused','started'));
```

Giải thích: suất A dùng khoảng `[startA,endA+15m)`, suất B chỉ được xếp khi `startB >= endA+15m`; loại state khỏi lịch phải được kiểm soát theo nghiệp vụ. Đây là SQL **minh họa**, cần đối chiếu enum/state/schema thật trước khi chạy.

## 5. Booking/payment/QR

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_provider_event
  ON booking.payment_events(provider_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_provider_ref
  ON booking.payments(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_qr_hash
  ON booking.tickets(qr_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkin_one_per_ticket
  ON operations.ticket_checkins(ticket_id);
```

- Tiền `BIGINT CHECK(amount_vnd>=0)`, cần giới hạn theo quy tắc business và xác nhận giá server-side.
- Token: chỉ lưu hash, QR opaque random token đủ entropy, không lưu plaintext QR secret.
- Timestamps dùng `timestamptz`, API trả UTC ISO-8601 `Z`, giao diện hiển thị Asia/Ho_Chi_Minh.
- Không có direct FK từ `booking` sang `showtime`, hay từ `operations` sang `booking`: external refs kiểm bằng API và reconcile jobs.

## 6. Migration order

1. Tạo schema, DB roles, extensions.
2. Identity và Catalog tables (users/movies/auditoriums/seats + seat_pairs).
3. Showtime showtimes/prices/holds/allocations + constraints.
4. Booking bookings/items/payments/events/tickets.
5. Operations checkins/audit; seed dữ liệu tiếng Việt.
6. Seed **20/12/2026 19:30 Asia/Ho_Chi_Minh**, tương ứng `2026-12-20T12:30:00Z`.

## 7. Cần test migration

- `knex migrate:latest` chạy từ DB trống, rollback/redo ở môi trường test.
- Vi phạm unique active hold/allocation trả conflict.
- Seat pair thiếu 1 seat bị từ chối khi publish/hold.
- Showtime chồng lịch hoặc buffer <15 phút bị từ chối.
- DB role của service không đọc/ghi được schema khác.
