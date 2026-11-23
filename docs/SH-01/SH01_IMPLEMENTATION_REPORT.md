# SH-01 Implementation Report

**Ticket:** SH-01 (SCRUM-25) — Database Migrations for Showtime, Pricing, Seat Holding, and Seat Allocation  
**Owner:** Đào Duy Hoàng (TV3) | **Reviewer:** Võ Minh Huy (TV5)  
**Branch:** `TV3Hoàng` (preserving untracked `frontend/src/features/reports/index.ts`)  
**Milestone Status:** M3 Complete (Migrations, Logger Helper, Documentation, Provisional Disposable Fixtures, and PostgreSQL 17.12 Integration & Concurrency Suite Executed)

---

## 1. Summary of Implemented Artifacts

### Migration Logger Helper
- `backend/core-service/db/utils/migration-logger.ts`
  - Reuses `backend/core-service/src/common/utils/logger.ts` via dynamic fallback (`../../src/common/utils/logger.js` -> `../../dist/src/common/utils/logger.js` -> matching structured JSON writer suppressed when `NODE_ENV === 'test'`).
  - Logs `Migration started`, `Migration completed` (`durationMs`), and `Migration failed` (`durationMs`, `errorCode`, `errorMessage` with connection URI & credential redaction).

### Production Knex Migrations (`core` Schema)
1. `backend/core-service/db/migrations/20261122083000_create_showtimes_table.ts` — `core.showtimes` (`btree_gist` guard, `chk_showtimes_time_order`, `chk_showtimes_format`, `chk_showtimes_state`, `uq_showtimes_id_auditorium`, PG 17 `IMMUTABLE`-safe `showtime_no_room_overlap` 15-minute buffer exclusion constraint, `idx_showtime_filter` & single-column indexes).
2. `backend/core-service/db/migrations/20261122083100_create_ticket_prices_table.ts` — `core.ticket_prices` (`BIGINT` VND `>= 0`, `uq_ticket_prices_showtime_seat_type`, `idx_ticket_prices_showtime_id`).
3. `backend/core-service/db/migrations/20261122083200_create_seat_hold_groups_table.ts` — `core.seat_hold_groups` (`owner_ref` non-empty check, `expires_at > created_at`, `uq_seat_hold_groups_id_showtime`, `uq_hold_idempotency`, active expiry index).
4. `backend/core-service/db/migrations/20261122083300_create_seat_holds_table.ts` — `core.seat_holds` (composite FKs to `seat_hold_groups`, `showtimes`, and `seats`; `uq_seat_holds_group_seat`; `uq_seat_hold_active` without `NOW()`).
5. `backend/core-service/db/migrations/20261122083400_create_seat_allocations_table.ts` — `core.seat_allocations` (composite FKs to `showtimes`, `seats`, `seat_hold_groups`; `booking_id UUID NOT NULL` with deferred `BO-01` FK; `chk_seat_allocations_status_cancelled_at`; `uq_seat_allocation_active`).

### Isolated Disposable PG 17 Test Suite & Provisional Fixtures
- `backend/core-service/tests/fixtures/ca01-bo01-provisional.ts` — Strictly isolated, test-only provisional CA-01 (`movies`, `cinemas`, `auditoriums`, `seat_pairs`, `seats`) and BO-01 (`bookings` + `fk_seat_allocations_booking`) schema helpers and catalog seeders (never placed in `db/migrations/`).
- `backend/core-service/tests/sh01-migrations.integration.test.ts` — 14 Vitest PostgreSQL 17 integration & concurrency tests gated on `process.env.SH01_TEST_DATABASE_URL` covering:
  - Production blocking check without CA-01 (`42P01` + redacted JSON logs)
  - Full `up()` / 5x reverse `down()` / re-`up()` lifecycle with `btree_gist` preservation
  - System catalog inspection (`information_schema.columns`, `pg_constraint`, `pg_indexes`)
  - `core.showtimes` time order, cinema-auditorium FK, 14m/15m buffer boundary, 2-connection concurrency (`23P01` / `40P01`), and cancelled/completed rescheduling policy
  - `core.ticket_prices` `BIGINT` VND pricing, non-negative check, and uniqueness
  - `core.seat_hold_groups` & `core.seat_holds` auth/guest `owner_ref`, idempotency, couple rows, expiry checks, cross-auditorium FKs, 2-connection hold race (`23505`), and release-to-rehold
  - `core.seat_allocations` active uniqueness, cross-auditorium FK, soft-cancellation history preservation & reallocation, 2-connection race (`23505`), and provisional `BO-01` deferred FK contract.

### Documentation Suite (`docs/SH-01/`)
- `docs/SH-01/SH01_CONTRACT_AUDIT.md`
- `docs/SH-01/SH01_DATABASE_DESIGN.md`
- `docs/SH-01/SH01_DEPENDENCIES.md`
- `docs/SH-01/SH01_TEST_REPORT.md`
- `docs/SH-01/SH01_IMPLEMENTATION_REPORT.md`

---

## 2. QA & Verification Status (M3 Executed Results)

- `npm run lint`: **PASS** (`LINT_EXIT=0`)
- `npm --workspace @cinema/core-service run typecheck`: **PASS** (`TYPECHECK_EXIT=0`)
- `npm --workspace @cinema/core-service run build`: **PASS** (`BUILD_EXIT=0`)
- `npm --workspace @cinema/core-service run test` (without `SH01_TEST_DATABASE_URL`): **PASS** (`TEST_SKIP_EXIT=0`, `4 passed | 14 skipped (18)`)
- `SH01_TEST_DATABASE_URL=... npm --workspace @cinema/core-service run test -- --reporter=verbose` against ephemeral `postgres:17-alpine` (`PostgreSQL 17.12`, `127.0.0.1:55432`): **PASS** (`VITEST_PG17_EXIT=0`, `18 passed (18)`)
- Ephemeral container cleanup (`docker rm -f sh01-ephemeral-pg17`): **PASS** (`REMAINING_SH01_CONTAINERS=` empty; `cinema-postgres` untouched)
- Production `knex migrate:latest` end-to-end execution without provisional fixtures: **BLOCKED** on missing TV2 (`CA-01`) parent tables (verified in test via `42P01` `relation "core.movies" does not exist` and redacted JSON logs; full verbatim outputs recorded in `docs/SH-01/SH01_TEST_REPORT.md`).

---

## 3. Risks & Open Dependencies

| Risk / Blocker | Severity | Mitigation |
|---|---|---|
| Missing TV2 (`CA-01`) parent tables (`movies`, `cinemas`, `auditoriums`, `seats`) | **Blocker (for prod migration run)** | Reserved `20261119160000`–`20261122082959` window and documented required `uq_auditoriums_id_cinema` & `uq_seats_id_auditorium` keys in `SH01_DEPENDENCIES.md`. |
| Missing TV4 (`BO-01`) `core.bookings` table | **Medium (Design Resolved)** | Deferred `fk_seat_allocations_booking` to `BO-01` (`> 20261122083400`) with turnkey SQL/Knex snippet in `SH01_DEPENDENCIES.md` (verified provisionally in M3). |
| TV1 `ID-01` `INTEGER` PKs on `core.roles` / `core.users` | **Medium** | `core.seat_hold_groups` uses `owner_ref VARCHAR(255)` rather than a type-mismatched `UUID` FK to `core.users(id)`. |
| `openapi/cinema-api.yaml` `Showtime.state` omits `'cancelled'` | **Low** | Documented for `SH-02` API implementation; DB `CHECK` includes `'cancelled'` while GiST exclusion filters active states only. |

---

## 4. Scope Boundary Compliance

- No teammates' files were modified (`db/migrations/20261119*`, `src/modules/*`, `frontend/src/features/reports/index.ts`, `backend/notification-service/*`, `package.json`, `tsconfig.json` all untouched).
- No fake CA-01 or BO-01 parent tables were created in `db/migrations/`.
- No essential FKs were dropped; no database credentials were hardcoded in source or test files.
- `pino` / `pino-http` were not installed; `src/common/middleware/requestId.ts` was not modified.
- No Git branch switches, commits, pushes, pulls, or merges were executed; `cinema-postgres` was not mutated.
