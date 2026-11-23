# SH-01 Dependencies & Integration Contracts (`CA-01`, `BO-01`, `OP-04`)

**Ticket:** SH-01 (SCRUM-25)  
**Dependency Status:** Migration ordering has been remediated to `ID-01 -> CA-01 -> SH-01 -> BO-01` (`20261122161000`–`20261122161400`). However, running `knex migrate:latest` against the real merged repository remains **`BLOCKED` (`SQLSTATE 42830` / `42883`)** because TV2 (`CA-01`) omitted `UNIQUE (id, cinema_id)` on `core.auditoriums`, omitted `UNIQUE (id, auditorium_id)` on `core.seats`, used unqualified `uuid_generate_v4()` under `01-init-schemas.sql` + `searchPath: ['core']`, and omitted the composite `(couple_pair_id, auditorium_id)` FK on `core.seats`. `core.seat_allocations.booking_id` FK is deferred to TV4 (`BO-01`, `20261122170500`) and is schema-compatible.

---

## 1. Upstream & Downstream Dependencies

| Ticket / Owner | Tables | Required Role Relative to SH-01 |
|---|---|---|
| **TV2 (`CA-01`, merged `827081d`)** | `core.movies`, `core.cinemas`, `core.auditoriums`, `core.seat_pairs`, `core.seats` | **Upstream Parents:** Referenced directly by `core.showtimes`, `core.seat_holds`, and `core.seat_allocations` via `ON DELETE RESTRICT` FKs. Missing two required composite unique keys (`42830`). |
| **TV4 (`BO-01`, merged `8377a47`)** | `core.bookings`, `core.booking_seats`, `core.concessions`, `core.booking_concessions`, `core.tickets`, `payment.*` | **Downstream Child + Deferred FK:** `core.bookings.hold_group_id` references `core.seat_hold_groups(id)`, and `20261122170500_add_seat_allocations_booking_fk.ts` adds `fk_seat_allocations_booking` onto `core.seat_allocations(booking_id)`. |
| **TV5 (`OP-04`)** | Seed data (`D-16`) | **Seed Dependency:** `IMPLEMENTATION-BACKLOG.md:29` assigns the `20/12/2026 19:30 VN` (`2026-12-20T12:30:00Z`) showtime seed to `OP-04` (TV5). |

Per R3, SH-01 production migrations contain **zero fake parent tables** and retain all real CA-01 foreign keys.

---

## 2. Actual Merged Migration Ordering (Zero Circular Dependencies)

| Order | Owner / Ticket | Migration Timestamp Window | Contents |
|---|---|---|---|
| 0 | Infra | `01-init-schemas.sql` | `core`, `payment`, `notification` schemas + `"uuid-ossp"`, `"btree_gist"` |
| 1–5 | TV1 (`ID-01`, merged) | `20261119153810`–`20261119153952` | Auth tables (`roles`, `users`, `email_verifications`, `refresh_tokens`, `password_resets`) |
| **6–11** | **TV2 (`CA-01`, merged)** | **`20261122160000`–`20261122160500`** | `core.movies`, `core.cinemas`, `core.auditoriums`, `core.seat_pairs`, `core.seats`, `users.cinema_id` UUID FK |
| **12–16** | **TV3 (`SH-01`, remediated)** | **`20261122161000`–`20261122161400`** | `core.showtimes`, `core.ticket_prices`, `core.seat_hold_groups`, `core.seat_holds`, `core.seat_allocations` |
| **17–22** | **TV4 (`BO-01`, merged)** | **`20261122170000`–`20261122170500`** | `core.concessions`, `core.bookings`, `core.booking_seats`, `core.booking_concessions`, `core.tickets`, `fk_seat_allocations_booking` |

### Persistent-DB `knex_migrations` Reconciliation Note
Before this remediation, SH-01 migrations had legacy `083000`–`083400` timestamps (`2026-11-22 08:30–08:34`), which failed immediately on any clean database with `SQLSTATE 42P01` (`relation "core.movies" does not exist`), preventing normal `knex migrate:latest` from recording them. However, if any shared or local persistent database ever applied SH-01 manually after provisional CA-01 tables, **verify `core.knex_migrations` before running `knex migrate:latest`**:

```sql
SELECT id, name, batch, migration_time
FROM core.knex_migrations
WHERE name LIKE '%create_showtimes_table%'
   OR name LIKE '%create_ticket_prices_table%'
   OR name LIKE '%create_seat_hold_groups_table%'
   OR name LIKE '%create_seat_holds_table%'
   OR name LIKE '%create_seat_allocations_table%'
ORDER BY id;
```

If legacy `083000`–`083400` rows exist in a persistent environment, do **not** drop tables with data; either reconcile `core.knex_migrations.name` to the `20261122161000`–`20261122161400` filenames in a single audited transaction (and verify `chk_seat_hold_groups_status_released_at` is applied) or reset/re-migrate if the database is disposable.

---

## 3. Required `CA-01` Contract & Verified Blockers for TV2 (`SQLSTATE 42830` / `42883`)

SH-01 enforces same-cinema auditorium validity and same-auditorium seat validity declaratively in PostgreSQL, and runs under `knexfile.ts`'s `searchPath: ['core']` on databases initialized by `infrastructure/docker/postgres/init/01-init-schemas.sql` (where `uuid-ossp` and `btree_gist` live in `public`). Verified TV2 (`CA-01`) blockers across `20261122160000`–`20261122160400`:

1. **Missing `UNIQUE (id, cinema_id)` on `core.auditoriums` (`SQLSTATE 42830`):** `20261122160200_create_auditoriums_table.ts:54-57` defines only `uq_auditoriums_cinema_name` (`UNIQUE (cinema_id, name)`). Must add **`CONSTRAINT uq_auditoriums_id_cinema UNIQUE (id, cinema_id)`** required by `fk_showtimes_auditorium_cinema` (`20261122161000`).
2. **Missing `UNIQUE (id, auditorium_id)` on `core.seats` (`SQLSTATE 42830`):** `20261122160400_create_seats_table.ts:65-68` defines only `uq_seats_auditorium_position`. Must add **`CONSTRAINT uq_seats_id_auditorium UNIQUE (id, auditorium_id)`** required by `fk_seat_holds_seat_auditorium` (`20261122161300`) and `fk_seat_allocations_seat_auditorium` (`20261122161400`).
3. **`uuid_generate_v4()` invisible under `01-init-schemas.sql` + `searchPath: ['core']` (`SQLSTATE 42883`):** `20261122160000_create_movies_table.ts:19`, `20261122160100_create_cinemas_table.ts:17`, `20261122160200_create_auditoriums_table.ts:17`, `20261122160300_create_seat_pairs_table.ts:20`, and `20261122160400_create_seats_table.ts:24` all use unqualified `uuid_generate_v4()`. Because `01-init-schemas.sql` installs `"uuid-ossp"` in `public` while `knexfile.ts` sets `searchPath: ['core']`, PostgreSQL rejects `DEFAULT uuid_generate_v4()` with `SQLSTATE 42883` (`function uuid_generate_v4() does not exist`). TV2 must replace `uuid_generate_v4()` with built-in `gen_random_uuid()` (`pg_catalog`, matching `SH-01`, `BO-01`, and `OP-02`) or schema-qualify `public.uuid_generate_v4()`.
4. **Non-composite `couple_pair_id` FK on `core.seats`:** `20261122160300_create_seat_pairs_table.ts:34-39` already defines `uq_seat_pairs_id_auditorium` (`UNIQUE (id, auditorium_id)`) with comment *"Allows seats to have a composite FK (couple_pair_id, auditorium_id)"*, but `20261122160400_create_seats_table.ts:50-56` creates only a single-column FK `couple_pair_id REFERENCES seat_pairs(id)`. TV2 should upgrade this to composite `FOREIGN KEY (couple_pair_id, auditorium_id) REFERENCES seat_pairs(id, auditorium_id) ON DELETE RESTRICT` to prevent cross-auditorium couple seat pairing.

### `core` Table Contract Summary
1. **`core.movies`** (`20261122160000`): `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `duration_min INTEGER NOT NULL CHECK (duration_min > 0)`. *(Change `uuid_generate_v4()` -> `gen_random_uuid()`)*
2. **`core.cinemas`** (`20261122160100`): `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `address VARCHAR(500) NOT NULL`, `city VARCHAR(100) NOT NULL`. *(Change `uuid_generate_v4()` -> `gen_random_uuid()`)*
3. **`core.auditoriums`** (`20261122160200`):
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` *(Change `uuid_generate_v4()`)*
   - `cinema_id UUID NOT NULL REFERENCES cinemas(id) ON DELETE RESTRICT`
   - **`CONSTRAINT uq_auditoriums_id_cinema UNIQUE (id, cinema_id)`** *(MISSING in merged `827081d` — `SQLSTATE 42830`)*
4. **`core.seat_pairs`** (`20261122160300`):
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` *(Change `uuid_generate_v4()`)*
   - `auditorium_id UUID NOT NULL REFERENCES auditoriums(id) ON DELETE RESTRICT`
   - `UNIQUE (id, auditorium_id)` *(Present in `20261122160300`; no `pair_code` column)*
5. **`core.seats`** (`20261122160400`):
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` *(Change `uuid_generate_v4()`)*
   - `auditorium_id UUID NOT NULL REFERENCES auditoriums(id) ON DELETE RESTRICT`
   - `seat_type VARCHAR(20) NOT NULL CHECK (seat_type IN ('standard', 'vip', 'couple'))`
   - `couple_pair_id UUID NULL` with **composite FK `(couple_pair_id, auditorium_id) REFERENCES seat_pairs(id, auditorium_id) ON DELETE RESTRICT`** *(Currently single-column FK to `seat_pairs(id)`)*
   - `is_active BOOLEAN NOT NULL DEFAULT true`
   - `UNIQUE (auditorium_id, row_label, seat_number)`
   - **`CONSTRAINT uq_seats_id_auditorium UNIQUE (id, auditorium_id)`** *(MISSING in merged `827081d` — `SQLSTATE 42830`)*

### Empirical `btree_gist` & `search_path = core` Verification (`20261122161000`)
- When `01-init-schemas.sql` pre-installs `"btree_gist"` in `public` and `knexfile.ts` sets `searchPath: ['core']`, `pg_opclass_is_visible` for `public.gist_uuid_ops` is `false`.
- Empirically verified on a disposable PostgreSQL 17.12 container initialized with `01-init-schemas.sql` and Knex `searchPath: ['core']`: executing `20261122161000_create_showtimes_table.ts` (`up()`, `down()`, and `re-up()`) **succeeded cleanly with zero errors (`SQLSTATE 42704` does NOT occur)**. Because `showtime_no_room_overlap` uses `auditorium_id WITH =` (without naming `gist_uuid_ops`), PostgreSQL resolves the default GiST operator class for `pg_catalog.uuid` (`opcdefault = true`) directly rather than via `search_path`. All 5 SH-01 migrations also use `gen_random_uuid()` (`pg_catalog`), so SH-01 is unaffected by `public` extension placement.

---

## 4. `BO-01` Deferred FK Verification (TV4)

`core.bookings` (`20261122170100`) references `core.seat_hold_groups(id)` (`ON DELETE RESTRICT`), while `core.seat_allocations.booking_id` references `core.bookings(id)`. `SH-01` (`20261122161400`) creates `core.seat_allocations.booking_id UUID NOT NULL` + `idx_seat_allocations_booking_id` without the FK, and TV4's `20261122170500_add_seat_allocations_booking_fk.ts` cleanly adds `fk_seat_allocations_booking` (`ON DELETE RESTRICT`) in `up()` and drops it in `down()`.

No SH-01/BO-01 schema incompatibility exists; BO-01 is blocked downstream only by CA-01 -> SH-01 (`42830`).

### Couple Pricing Granularity Contract
`core.ticket_prices.amount_vnd` for `seat_type = 'couple'` represents the price **per physical `seat_id`**, matching `SeatState.priceVnd` in `openapi/cinema-api.yaml` and `booking_seats.unit_price_vnd` (`erd-detailed.mmd`). A couple pair consists of 2 physical `seat_id` rows (`D-15`), so total couple-pair price = `2 * amount_vnd`.

---

## 5. `D-16` Showtime Seed Dependency (`OP-04` / TV5)

- `docs/DECISIONS.md:22` (`D-16`) and `docs/04-delivery/IMPLEMENTATION-BACKLOG.md:29` assign the `20/12/2026 19:30 Asia/Ho_Chi_Minh` (`2026-12-20T12:30:00Z`) showtime seed to **TV5 (`OP-04`)** (`seed (20/12/2026 19:30 VN), Playwright E2E`).
- `backend/core-service/db/seeds/01_catalog.ts` (TV2 CA-01) provides deterministic catalog UUIDs (`MOVIE_IDS`, `CINEMA_IDS`, `AUDITORIUM_IDS`, `SEAT_PAIR_IDS`) and leaves a comment expecting a showtime seed.
- **Seed Re-Run Caveat:** `01_catalog.ts` currently starts with unconditional `.del()` calls (`seats`, `seat_pairs`, `auditoriums`, `cinemas`, `movies`). Once `core.showtimes`, `core.seat_holds`, or `core.seat_allocations` contain rows, running `01_catalog.ts` after showtime seeding will fail with `SQLSTATE 23503` (`ON DELETE RESTRICT`). When TV5 implements the `OP-04` showtime seed (e.g., `02_showtimes.ts` / `03_showtimes.ts`), `01_catalog.ts` and `OP-04` must coordinate idempotent seeding (`onConflict(...).merge()` or ordered child cleanup) before `db:seed:run`.
