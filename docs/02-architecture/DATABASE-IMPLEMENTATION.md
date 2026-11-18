# Database Implementation Blueprint — PostgreSQL 17 + Knex 3 (3 Schemas)

> **Thiết kế để triển khai, chưa phải migrations nghiệp vụ đã chạy.** Cập nhật theo **D-04 (`ACCEPTED — REVISED`)** và D-05..D-18. Áp dụng qua Knex migrations riêng cho từng service (`core-service`, `payment-service`, `notification-service`) trên PostgreSQL 17.

## 1. Phân quyền 3 Schemas (`core`, `payment`, `notification`)

```sql
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS notification;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
-- Production: mỗi service dùng DB role/search_path riêng và chỉ CRUD schema do mình sở hữu.
-- Core Service -> schema "core"
-- Payment Service -> schema "payment"
-- Notification Service -> schema "notification"
```

## 2. Core Schema: Model ghế đôi (`core.seat_pairs` & `core.seats`)

```sql
CREATE TABLE core.seat_pairs (
  id uuid PRIMARY KEY,
  auditorium_id uuid NOT NULL REFERENCES core.auditoriums(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, auditorium_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seat_pair_position
  ON core.seats(auditorium_id, row_label, seat_number);
```

**Quy tắc:** Hai ghế cùng `auditorium_id`, `seat_type = 'couple'`, `couple_pair_id` giống nhau. Đúng 2 thành viên mỗi cặp được bảo đảm trong transaction. Booking count dùng seat ID vật lý; cặp tính 2/8 (D-06, D-15).

## 3. Core Schema: Giữ ghế & Phân bổ ghế đồng thời (`core.seat_holds` & `core.seat_allocations`)

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_hold_active
  ON core.seat_holds(showtime_id, seat_id)
  WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_allocation_active
  ON core.seat_allocations(showtime_id, seat_id)
  WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_hold_idempotency
  ON core.seat_hold_groups(owner_ref, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

**Cảnh báo SQL:** `WHERE expires_at > now()` không được dùng trong partial unique index vì `now()` không immutable. Index theo `status='active'`, quy trình transaction trong `core-service` đánh dấu các hold đã hết hạn trước khi thử hold mới:

```text
BEGIN
SELECT id FROM core.showtimes WHERE id=:showtimeId FOR UPDATE;
UPDATE core.seat_holds SET status='expired' WHERE showtime_id=:showtimeId
  AND status='active' AND expires_at <= transaction_timestamp();
-- SELECT current allocated and held rows for requested seatIds;
-- verify unique, same auditorium, all couple pair members and <=8 physical seats;
-- INSERT hold_group, each hold row, idempotency key;
COMMIT
```

## 4. Core Schema: Không chồng suất cùng phòng với buffer 15 phút (D-11)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE core.showtimes
  ADD CONSTRAINT showtime_no_room_overlap
  EXCLUDE USING gist (
    auditorium_id WITH =,
    tstzrange(starts_at, ends_at + interval '15 minutes', '[)') WITH &&
  ) WHERE (state IN ('draft','on_sale','sales_paused','started'));
```

## 5. Core, Payment & Notification Indexes

```sql
-- Core schema: QR & Check-in
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_qr_hash
  ON core.tickets(qr_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkin_one_per_ticket
  ON core.ticket_checkins(ticket_id);

-- Payment schema: Webhook idempotency & provider references
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_provider_event
  ON payment.payment_events(provider_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_provider_ref
  ON payment.payments(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_idempotency
  ON payment.refunds(idempotency_key);

-- Notification schema: Delivery idempotency
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_delivery_idempotency
  ON notification.notification_deliveries(idempotency_key);
```

- Tiền `BIGINT CHECK(amount_vnd >= 0)`, xác nhận giá server-side (D-18).
- Token: chỉ lưu hash, QR opaque random token đủ entropy, không lưu plaintext QR secret.
- Không có direct FK giữa `core`, `payment` và `notification`: external refs (`booking_id`, `payment_id`) kiểm bằng REST API và job đối soát.

## 6. Migration Order

1. Khởi tạo 3 schemas (`core`, `payment`, `notification`) và extensions (`uuid-ossp`, `btree_gist`).
2. `core-service` migrations:
   - Auth/Users/Roles (`users`, `roles`, `user_roles`, `refresh_sessions`, `email_verifications`).
   - Catalog (`movies`, `cinemas`, `auditoriums`, `seat_pairs`, `seats`).
   - Showtimes & Seat Allocation (`showtimes`, `ticket_prices`, `seat_hold_groups`, `seat_holds`, `seat_allocations`).
   - Bookings, Concessions & Tickets (`bookings`, `booking_seats`, `concessions`, `booking_concessions`, `tickets`).
   - Check-ins & Audit (`ticket_checkins`, `audit_logs`).
3. `payment-service` migrations: `payments`, `payment_events`, `refunds`.
4. `notification-service` migrations: `notification_templates`, `notification_deliveries`.
5. Seed dữ liệu tiếng Việt, bao gồm suất chiếu bắt buộc **20/12/2026 19:30 Asia/Ho_Chi_Minh** (`2026-12-20T12:30:00Z`, D-16).
