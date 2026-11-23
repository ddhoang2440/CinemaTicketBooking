# SH-01 Database Design (`core` Schema)

**Ticket:** SH-01 (SCRUM-25)  
**PostgreSQL Target:** PostgreSQL 17 (`search_path = core`, schema-qualified `core.*` DDL)  
**Knex Migrations:** `backend/core-service/db/migrations/20261122083000`–`20261122083400`

---

## 1. Entity-Relationship Diagram (Mermaid ERD)

```mermaid
erDiagram
  MOVIES ||--o{ SHOWTIMES : schedules
  CINEMAS ||--o{ AUDITORIUMS : houses
  CINEMAS ||--o{ SHOWTIMES : hosts_at_cinema
  AUDITORIUMS ||--o{ SHOWTIMES : hosts_in_room
  AUDITORIUMS ||--o{ SEAT_PAIRS : defines
  AUDITORIUMS ||--o{ SEATS : contains
  SEAT_PAIRS o|--o{ SEATS : pairs_two
  SHOWTIMES ||--o{ TICKET_PRICES : prices
  SHOWTIMES ||--o{ SEAT_HOLD_GROUPS : scopes_holds
  SEAT_HOLD_GROUPS ||--|{ SEAT_HOLDS : contains
  SHOWTIMES ||--o{ SEAT_HOLDS : reserves_in
  SEATS ||--o{ SEAT_HOLDS : held_seat
  SHOWTIMES ||--o{ SEAT_ALLOCATIONS : allocates_for
  SEATS ||--o{ SEAT_ALLOCATIONS : allocated_seat
  SEAT_HOLD_GROUPS o|--o{ SEAT_ALLOCATIONS : originates_from
  SEAT_HOLD_GROUPS ||--o{ BOOKINGS : converts_to
  BOOKINGS ||--o{ SEAT_ALLOCATIONS : confirms_deferred_fk

  MOVIES {
    uuid id PK
    int duration_min
  }
  CINEMAS {
    uuid id PK
  }
  AUDITORIUMS {
    uuid id PK
    uuid cinema_id FK_UK
  }
  SEATS {
    uuid id PK
    uuid auditorium_id FK_UK
    string seat_type
    uuid couple_pair_id
  }
  SHOWTIMES {
    uuid id PK
    uuid movie_id FK
    uuid cinema_id FK
    uuid auditorium_id FK_UK
    timestamptz starts_at
    timestamptz ends_at
    string format
    string state
  }
  TICKET_PRICES {
    uuid id PK
    uuid showtime_id FK
    string seat_type
    bigint amount_vnd
  }
  SEAT_HOLD_GROUPS {
    uuid id PK
    uuid showtime_id FK_UK
    string owner_ref
    string status
    string idempotency_key
    timestamptz expires_at
    timestamptz released_at
  }
  SEAT_HOLDS {
    uuid id PK
    uuid hold_group_id FK
    uuid showtime_id FK
    uuid auditorium_id FK
    uuid seat_id FK
    string status
    timestamptz expires_at
  }
  SEAT_ALLOCATIONS {
    uuid id PK
    uuid showtime_id FK
    uuid auditorium_id FK
    uuid seat_id FK
    uuid booking_id "Deferred FK -> core.bookings(id)"
    uuid hold_group_id FK_NULL
    string status
    timestamptz confirmed_at
    timestamptz cancelled_at
  }
  BOOKINGS {
    uuid id PK
    uuid hold_group_id FK
  }
```

---

## 2. Five-Table Schema Summary

### 2.1 `core.showtimes` (`20261122083000_create_showtimes_table.ts`)

| Column | Type | Constraints / Default | Purpose |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Showtime identifier |
| `movie_id` | `UUID` | `NOT NULL`, `fk_showtimes_movie -> core.movies(id) ON DELETE RESTRICT` | Scheduled movie |
| `cinema_id` | `UUID` | `NOT NULL`, `fk_showtimes_cinema -> core.cinemas(id) ON DELETE RESTRICT` | Cinema denormalized safely via composite FK for `idx_showtime_filter` |
| `auditorium_id` | `UUID` | `NOT NULL`, `fk_showtimes_auditorium_cinema (auditorium_id, cinema_id) -> core.auditoriums(id, cinema_id) ON DELETE RESTRICT` | Hosting room guaranteed in `cinema_id` |
| `starts_at` | `TIMESTAMPTZ` | `NOT NULL` | UTC screening start |
| `ends_at` | `TIMESTAMPTZ` | `NOT NULL` | UTC screening end |
| `format` | `VARCHAR(10)` | `NOT NULL`, `CHECK (format IN ('2D', '3D', 'IMAX'))` | Screening format |
| `state` | `VARCHAR(20)` | `NOT NULL DEFAULT 'draft'`, `CHECK (state IN ('draft', 'on_sale', 'sales_paused', 'started', 'completed', 'cancelled'))` | Showtime lifecycle state |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Audit creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Audit update timestamp |

**Constraints & Indexes:**
- Extension guard: `CREATE EXTENSION IF NOT EXISTS btree_gist;` (not dropped in `down()`).
- `chk_showtimes_time_order`: `CHECK (ends_at > starts_at)`.
- `uq_showtimes_id_auditorium`: `UNIQUE (id, auditorium_id)` (composite FK target for `seat_holds` & `seat_allocations`).
- `showtime_no_room_overlap`: `EXCLUDE USING gist (auditorium_id WITH =, tstzrange(starts_at, timezone(interval '0', (ends_at AT TIME ZONE 'UTC') + interval '15 minutes'), '[)') WITH &&) WHERE (state IN ('draft', 'on_sale', 'sales_paused', 'started'))`.
- Indexes: `idx_showtime_filter (cinema_id, starts_at, state)`, `idx_showtimes_movie_id (movie_id)`, `idx_showtimes_auditorium_id (auditorium_id)`, `idx_showtimes_starts_at (starts_at)`.

---

### 2.2 `core.ticket_prices` (`20261122083100_create_ticket_prices_table.ts`)

| Column | Type | Constraints / Default | Purpose |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Price rule identifier |
| `showtime_id` | `UUID` | `NOT NULL`, `fk_ticket_prices_showtime -> core.showtimes(id) ON DELETE RESTRICT` | Owning showtime (carries `format`) |
| `seat_type` | `VARCHAR(20)` | `NOT NULL`, `CHECK (seat_type IN ('standard', 'vip', 'couple'))` | Pricing tier |
| `amount_vnd` | `BIGINT` | `NOT NULL`, `CHECK (amount_vnd >= 0)` | Server-authoritative integer VND price per physical `seat_id` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Audit creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Audit update timestamp |

**Constraints & Indexes:**
- `uq_ticket_prices_showtime_seat_type`: `UNIQUE (showtime_id, seat_type)`
- `idx_ticket_prices_showtime_id`: `INDEX (showtime_id)`

---

### 2.3 `core.seat_hold_groups` (`20261122083200_create_seat_hold_groups_table.ts`)

| Column | Type | Constraints / Default | Purpose |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Hold operation identifier |
| `showtime_id` | `UUID` | `NOT NULL`, `fk_seat_hold_groups_showtime -> core.showtimes(id) ON DELETE RESTRICT` | Target showtime |
| `owner_ref` | `VARCHAR(255)` | `NOT NULL`, `CHECK (char_length(trim(owner_ref)) > 0)` | Authenticated or guest identity (`user:<id>` or `guest:<sessionHash>`) |
| `status` | `VARCHAR(30)` | `NOT NULL DEFAULT 'active'`, `CHECK (status IN ('active', 'confirmed', 'released', 'expired'))` | Hold group lifecycle state |
| `idempotency_key` | `VARCHAR(128)` | `NULL` | Client `Idempotency-Key` |
| `expires_at` | `TIMESTAMPTZ` | `NOT NULL`, `CHECK (expires_at > created_at)` | Server-assigned TTL (`NOW() + 300s` per `D-05`) |
| `released_at` | `TIMESTAMPTZ` | `NULL`, `CHECK (released_at IS NULL OR released_at >= created_at)` | Release/confirmation/expiry timestamp |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Audit creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Audit update timestamp |

**Constraints & Indexes:**
- `uq_seat_hold_groups_id_showtime`: `UNIQUE (id, showtime_id)`
- `uq_hold_idempotency`: `CREATE UNIQUE INDEX uq_hold_idempotency ON core.seat_hold_groups (owner_ref, idempotency_key) WHERE idempotency_key IS NOT NULL`
- `idx_seat_hold_groups_showtime_id`: `INDEX (showtime_id)`
- `idx_seat_hold_groups_active_expires`: `CREATE INDEX idx_seat_hold_groups_active_expires ON core.seat_hold_groups (expires_at) WHERE status = 'active'`
- `idx_seat_hold_groups_owner_ref`: `INDEX (owner_ref, status)`

---

### 2.4 `core.seat_holds` (`20261122083300_create_seat_holds_table.ts`)

| Column | Type | Constraints / Default | Purpose |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Hold line item identifier |
| `hold_group_id` | `UUID` | `NOT NULL` | Parent hold group |
| `showtime_id` | `UUID` | `NOT NULL` | Showtime reference |
| `auditorium_id` | `UUID` | `NOT NULL` | Auditorium consistency anchor |
| `seat_id` | `UUID` | `NOT NULL` | Physical seat reference |
| `status` | `VARCHAR(30)` | `NOT NULL DEFAULT 'active'`, `CHECK (status IN ('active', 'confirmed', 'released', 'expired'))` | Hold item state |
| `expires_at` | `TIMESTAMPTZ` | `NOT NULL`, `CHECK (expires_at > created_at)` | Mirrored TTL for single-table expiry sweep |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Audit creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Audit update timestamp |

**Foreign Keys, Constraints & Indexes:**
- `fk_seat_holds_group_showtime`: `(hold_group_id, showtime_id) -> core.seat_hold_groups(id, showtime_id) ON DELETE RESTRICT`
- `fk_seat_holds_showtime_auditorium`: `(showtime_id, auditorium_id) -> core.showtimes(id, auditorium_id) ON DELETE RESTRICT`
- `fk_seat_holds_seat_auditorium`: `(seat_id, auditorium_id) -> core.seats(id, auditorium_id) ON DELETE RESTRICT`
- `uq_seat_holds_group_seat`: `UNIQUE (hold_group_id, seat_id)`
- `uq_seat_hold_active`: `CREATE UNIQUE INDEX uq_seat_hold_active ON core.seat_holds (showtime_id, seat_id) WHERE status = 'active'` (never uses `NOW()` in predicate)
- `idx_seat_holds_hold_group_id`: `INDEX (hold_group_id)`
- `idx_seat_holds_seat_id`: `INDEX (seat_id)`
- `idx_seat_holds_showtime_active_expires`: `CREATE INDEX idx_seat_holds_showtime_active_expires ON core.seat_holds (showtime_id, expires_at) WHERE status = 'active'`

---

### 2.5 `core.seat_allocations` (`20261122083400_create_seat_allocations_table.ts`)

| Column | Type | Constraints / Default | Purpose |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Confirmed seat allocation identifier |
| `showtime_id` | `UUID` | `NOT NULL` | Showtime reference |
| `auditorium_id` | `UUID` | `NOT NULL` | Auditorium consistency anchor |
| `seat_id` | `UUID` | `NOT NULL` | Physical seat reference |
| `booking_id` | `UUID` | `NOT NULL` | Owning booking (**deferred FK** -> `core.bookings(id)` added by BO-01) |
| `hold_group_id` | `UUID` | `NULL` | Optional audit link to originating hold group |
| `status` | `VARCHAR(30)` | `NOT NULL DEFAULT 'active'`, `CHECK (status IN ('active', 'cancelled'))` | Allocation status |
| `confirmed_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Confirmation timestamp |
| `cancelled_at` | `TIMESTAMPTZ` | `NULL` | Soft-cancellation timestamp |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Audit creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Audit update timestamp |

**Foreign Keys, Constraints & Indexes:**
- `fk_seat_allocations_showtime_auditorium`: `(showtime_id, auditorium_id) -> core.showtimes(id, auditorium_id) ON DELETE RESTRICT`
- `fk_seat_allocations_seat_auditorium`: `(seat_id, auditorium_id) -> core.seats(id, auditorium_id) ON DELETE RESTRICT`
- `fk_seat_allocations_hold_group_showtime`: `(hold_group_id, showtime_id) -> core.seat_hold_groups(id, showtime_id) ON DELETE RESTRICT` (`MATCH SIMPLE` allows `hold_group_id IS NULL`)
- `chk_seat_allocations_cancelled_after_confirmed`: `CHECK (cancelled_at IS NULL OR cancelled_at >= confirmed_at)`
- `chk_seat_allocations_status_cancelled_at`: `CHECK ((status = 'active' AND cancelled_at IS NULL) OR (status = 'cancelled' AND cancelled_at IS NOT NULL))`
- `uq_seat_allocation_active`: `CREATE UNIQUE INDEX uq_seat_allocation_active ON core.seat_allocations (showtime_id, seat_id) WHERE status = 'active'`
- Indexes: `idx_seat_allocations_booking_id (booking_id)`, `idx_seat_allocations_showtime_id (showtime_id)`, `idx_seat_allocations_seat_id (seat_id)`, `idx_seat_allocations_hold_group_id (hold_group_id) WHERE hold_group_id IS NOT NULL`.

---

## 3. PostgreSQL 17 GiST `IMMUTABLE` Exclusion Explanation

`docs/02-architecture/DATABASE-IMPLEMENTATION.md` §4 wrote `tstzrange(starts_at, ends_at + interval '15 minutes', '[)')`. In PostgreSQL 17, `timestamptz_pl_interval(timestamptz, interval)` is marked `STABLE` (`pg_proc.provolatile = 's'`), because adding calendar intervals like `'1 month'` to a `timestamptz` depends on the session `TimeZone` (DST rules). PostgreSQL therefore rejects `ends_at + interval '15 minutes'` inside an `EXCLUDE USING gist` index expression with:

> `ERROR: functions in index expression must be marked IMMUTABLE`

SH-01 fixes this using three `IMMUTABLE` (`provolatile = 'i'`) functions:
1. `ends_at AT TIME ZONE 'UTC'` (`timezone('UTC', timestamptz)`) -> `timestamp without time zone` (`IMMUTABLE`).
2. `... + interval '15 minutes'` (`timestamp_pl_interval`) -> `timestamp without time zone` (`IMMUTABLE`).
3. `timezone(interval '0', ...)` (`timezone(interval, timestamp)`) -> `timestamptz` at UTC (`IMMUTABLE`).

Wrapping `[starts_at, adjusted_ends_at)` in `tstzrange(..., '[)')` produces a timezone-invariant half-open range:
- Showtime A `[10:00:00Z, 12:00:00Z)` occupies `[10:00:00Z, 12:15:00Z)`.
- Showtime B starting at `12:14:00Z` or `12:14:59Z` overlaps -> rejected with PostgreSQL SQLSTATE `23P01` (`exclusion_violation`).
- Showtime B starting at `12:15:00Z` is disjoint because the upper bound `)` is exclusive -> accepted.
- Showtimes in different `auditorium_id`s are permitted because `auditorium_id WITH =` partitions the exclusion check per auditorium.

---

## 4. Policies: Cancelled Showtimes & Cancelled Allocations

1. **Cancelled / Completed Showtime Policy:**
   - `core.showtimes.state` supports `'cancelled'` alongside OpenAPI's `'draft' | 'on_sale' | 'sales_paused' | 'started' | 'completed'` (noting `SH-02` should align `openapi/cinema-api.yaml` enum).
   - `showtime_no_room_overlap` includes `WHERE (state IN ('draft', 'on_sale', 'sales_paused', 'started'))`.
   - When a screening transitions to `'cancelled'` or `'completed'`, the historical row is preserved (`ON DELETE RESTRICT`) while the auditorium slot is immediately freed for rescheduling.
2. **Cancelled Seat Allocation & Reallocation Policy (`D-07`):**
   - When an eligible booking is cancelled (`>= 120m` before `starts_at`, unchecked-in), `core.seat_allocations` transitions `status` from `'active'` to `'cancelled'` and sets `cancelled_at = NOW()`. Rows are never hard-deleted, preserving `booking_id` and `confirmed_at` history.
   - Because `uq_seat_allocation_active` filters `WHERE status = 'active'`, the `(showtime_id, seat_id)` slot immediately becomes available for subsequent holds and allocations.

---

## 5. DB-Enforced Constraints vs. API-Deferred Validations

| Rule / Invariant | Enforcement Layer | Mechanism |
|---|---|---|
| `ends_at > starts_at` | **PostgreSQL (`SH-01`)** | `chk_showtimes_time_order` |
| Same-auditorium overlap + 15-min buffer (`D-11`) | **PostgreSQL (`SH-01`)** | `showtime_no_room_overlap` (`EXCLUDE USING gist`) |
| Cancelled/completed showtime frees auditorium | **PostgreSQL (`SH-01`)** | Partial exclusion predicate `WHERE state IN (...)` |
| Non-negative integer VND (`D-18`) | **PostgreSQL (`SH-01`)** | `BIGINT` + `chk_ticket_prices_amount_nonnegative` |
| Unique price per `(showtime_id, seat_type)` | **PostgreSQL (`SH-01`)** | `uq_ticket_prices_showtime_seat_type` |
| Valid hold expiry (`expires_at > created_at`) | **PostgreSQL (`SH-01`)** | `CHECK` constraints on `seat_hold_groups` & `seat_holds` |
| Hold creation idempotency | **PostgreSQL (`SH-01`)** | `uq_hold_idempotency` partial unique index |
| No duplicate seat in one hold group | **PostgreSQL (`SH-01`)** | `uq_seat_holds_group_seat` |
| Max 1 active hold per `(showtime_id, seat_id)` (`D-12`) | **PostgreSQL (`SH-01`)** | `uq_seat_hold_active` (`WHERE status = 'active'`, no `NOW()`) |
| Max 1 active allocation per `(showtime_id, seat_id)` (`D-12`) | **PostgreSQL (`SH-01`)** | `uq_seat_allocation_active` (`WHERE status = 'active'`) |
| Seat belongs to showtime's auditorium | **PostgreSQL (`SH-01`)** | Composite FKs `(showtime_id, auditorium_id)` + `(seat_id, auditorium_id)` |
| Hold item belongs to hold group's showtime | **PostgreSQL (`SH-01`)** | Composite FK `(hold_group_id, showtime_id)` |
| `ends_at` matches `movies.duration_min` | **API (`SH-02`)** | Cross-table lookup against `core.movies` |
| `format` supported by `auditoriums.supported_formats` | **API (`SH-02`)** | Cross-table validation against `core.auditoriums` |
| Showtime `state = 'on_sale'` & before `starts_at` (`P-03`) | **API (`SH-03`)** | Verified under `FOR UPDATE` row lock |
| Fixed 300s hold TTL (`D-05`) & lazy expiry (`RV-03`) | **API (`SH-03`)** | Server clock + `UPDATE core.seat_holds SET status='expired'` in tx |
| Max 8 physical seats per hold/booking (`D-06`) | **API (`SH-03`/`BO-02`)** | Zod schema + service transaction |
| Couple pair completeness (`D-15`, `CT-02`/`03`) | **API (`SH-03`/`BO-02`)** | Validate all seats sharing `couple_pair_id` together |
| Seat `is_active = true` | **API (`SH-03`)** | Checked against `core.seats` |
| Cancel cutoff `>= 120m` & unchecked-in (`D-07`) | **API (`BO-02`)** | Verified in tx before soft-cancelling `seat_allocations` |
