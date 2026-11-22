# SH-01 Dependencies & Integration Contracts (`CA-01` & `BO-01`)

**Ticket:** SH-01 (SCRUM-25)  
**Dependency Status:** Production `knex migrate:latest` against a fresh database is **`BLOCKED`** on TV2 (`CA-01`) parent tables; `core.seat_allocations.booking_id` FK is **deferred** to TV4 (`BO-01`) to prevent a circular dependency.

---

## 1. Missing Upstream & Downstream Tables

| Ticket / Owner | Missing Tables | Required Role Relative to SH-01 |
|---|---|---|
| **TV2 (`CA-01`)** | `core.movies`, `core.cinemas`, `core.auditoriums`, `core.seat_pairs`, `core.seats` | **Upstream Parents:** Referenced directly by `core.showtimes`, `core.seat_holds`, and `core.seat_allocations` via `ON DELETE RESTRICT` FKs. |
| **TV4 (`BO-01`)** | `core.bookings`, `core.booking_seats`, `core.concessions`, `core.booking_concessions`, `core.tickets`, `payment.*` | **Downstream Child + Deferred FK:** `core.bookings.hold_group_id` references `core.seat_hold_groups(id)`, and `BO-01` adds `fk_seat_allocations_booking` onto `core.seat_allocations(booking_id)`. |

Per R3, SH-01 production migrations contain **zero fake parent tables** and retain all real CA-01 foreign keys.

---

## 2. Migration Ordering Windows (Zero Circular Dependencies)

| Order | Owner / Ticket | Migration Timestamp Window | Contents |
|---|---|---|---|
| 0 | Infra | `01-init-schemas.sql` | `core`, `payment`, `notification` schemas + `"uuid-ossp"`, `"btree_gist"` |
| 1–5 | TV1 (`ID-01`, merged) | `20261119153810`–`20261119153952` | Auth tables (`roles`, `users`, `email_verifications`, `refresh_tokens`, `password_resets`) |
| **6–10** | **TV2 (`CA-01`, reserved)** | **`20261119160000`–`20261122082959`** | `core.movies`, `core.cinemas`, `core.auditoriums`, `core.seat_pairs`, `core.seats` |
| **11–15** | **TV3 (`SH-01`, this ticket)** | **`20261122083000`–`20261122083400`** | `core.showtimes`, `core.ticket_prices`, `core.seat_hold_groups`, `core.seat_holds`, `core.seat_allocations` |
| **16+** | **TV4 (`BO-01`, future)** | **`> 20261122083400`** (e.g., `20261122090000+`) | `core.bookings`, `core.booking_seats`, `core.concessions`, `core.booking_concessions`, `core.tickets`, + `fk_seat_allocations_booking` |

---

## 3. Required `CA-01` Contract for TV2

SH-01 enforces same-cinema auditorium validity and same-auditorium seat validity declaratively in PostgreSQL. Therefore, TV2's `CA-01` migrations **must** include:

1. **`core.movies`**: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `duration_min INTEGER NOT NULL CHECK (duration_min > 0)`.
2. **`core.cinemas`**: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
3. **`core.auditoriums`**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `cinema_id UUID NOT NULL REFERENCES core.cinemas(id) ON DELETE RESTRICT`
   - **`CONSTRAINT uq_auditoriums_id_cinema UNIQUE (id, cinema_id)`** *(required by `fk_showtimes_auditorium_cinema`)*
4. **`core.seat_pairs`**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `auditorium_id UUID NOT NULL REFERENCES core.auditoriums(id) ON DELETE RESTRICT`
   - `UNIQUE (id, auditorium_id)`
5. **`core.seats`**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `auditorium_id UUID NOT NULL REFERENCES core.auditoriums(id) ON DELETE RESTRICT`
   - `seat_type VARCHAR(20) NOT NULL CHECK (seat_type IN ('standard', 'vip', 'couple'))`
   - `couple_pair_id UUID NULL`
   - `is_active BOOLEAN NOT NULL DEFAULT true`
   - `UNIQUE (auditorium_id, row_label, seat_number)`
   - **`CONSTRAINT uq_seats_id_auditorium UNIQUE (id, auditorium_id)`** *(required by `fk_seat_holds_seat_auditorium` and `fk_seat_allocations_seat_auditorium`)*

---

## 4. Turnkey `BO-01` Deferred FK Migration Contract for TV4

`core.bookings` references `core.seat_hold_groups(id)` (`erd-detailed.mmd`), while `core.seat_allocations.booking_id` references `core.bookings(id)`. To avoid a circular dependency, `SH-01` (`20261122083400`) creates `core.seat_allocations.booking_id UUID NOT NULL` + `idx_seat_allocations_booking_id` without the FK.

After creating `core.bookings`, TV4's `BO-01` migration (timestamp `> 20261122083400`) must execute:

```ts
// Inside BO-01 migration after core.bookings is created
export async function up(knex: Knex): Promise<void> {
  // ... create core.bookings (id UUID PRIMARY KEY, hold_group_id UUID NOT NULL REFERENCES core.seat_hold_groups(id) ON DELETE RESTRICT) ...

  await knex.raw(`
    ALTER TABLE core.seat_allocations
      ADD CONSTRAINT fk_seat_allocations_booking
      FOREIGN KEY (booking_id)
      REFERENCES core.bookings(id)
      ON DELETE RESTRICT
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE core.seat_allocations
      DROP CONSTRAINT IF EXISTS fk_seat_allocations_booking
  `);
  // ... drop core.bookings ...
}
```

### Couple Pricing Granularity Contract
`core.ticket_prices.amount_vnd` for `seat_type = 'couple'` represents the price **per physical `seat_id`**, matching `SeatState.priceVnd` in `openapi/cinema-api.yaml` and `booking_seats.unit_price_vnd` (`erd-detailed.mmd`). A couple pair consists of 2 physical `seat_id` rows (`D-15`), so total couple-pair price = `2 * amount_vnd`.

---

## 5. Exact Questions for TV2 and TV4

### Exact Questions for TV2 (`CA-01`)
1. Confirm `core.movies`, `core.cinemas`, `core.auditoriums`, `core.seat_pairs`, and `core.seats` all use `UUID` PKs/FKs (`gen_random_uuid()`), and confirm whether TV1's `users.cinema_id` (`INTEGER`) will be updated to `UUID`.
2. Confirm `core.auditoriums` will include `UNIQUE (id, cinema_id)` and `core.seats` will include `UNIQUE (id, auditorium_id)`.
3. Confirm `CA-01` migration timestamps will sit in `20261119160000`–`20261122082959`.
4. Confirm `core.auditoriums.supported_formats` representation and enum values (`'2D' | '3D' | 'IMAX'`).
5. Confirm `core.showtimes.cinema_id` aligns with `CA-01` / `SH-02` queries (`idx_showtime_filter`).

### Exact Questions for TV4 (`BO-01`)
1. Confirm `BO-01` runs after `20261122083400` and adds `fk_seat_allocations_booking` (`core.seat_allocations.booking_id -> core.bookings(id) ON DELETE RESTRICT`) in `up()` (and drops it in `down()`).
2. Confirm `core.seat_hold_groups` / `core.seat_holds` status enum `('active', 'confirmed', 'released', 'expired')` matches `BO-01` checkout (`pending_payment` keeps hold `'active'` until payment confirmation).
3. Confirm `BO-01` uses `core.seat_hold_groups.owner_ref VARCHAR(255)` rather than a `UUID` FK to `core.users(id)`.
4. Confirm `core.ticket_prices.amount_vnd` for `seat_type = 'couple'` is priced per physical `seat_id`.
5. Confirm `core.seat_allocations` soft-cancellation (`status = 'cancelled'`, `cancelled_at = NOW()`) and whether `core.tickets` links via `(booking_id, showtime_id, seat_id)` or `seat_allocation_id`.
