# SH-01 Implementation Report

**Ticket:** SH-01 (SCRUM-25) — Database Migrations for Showtime, Pricing, Seat Holding, and Seat Allocation  
**Owner:** Đào Duy Hoàng (TV3) | **Reviewer:** Võ Minh Huy (TV5)  
**Branch:** `fix/SH-01-integration` (branched from `main` at `f1cbc0a`)
**Milestone Status:** Post-Merge Remediation Final Validation Complete (Static Verification Passed; Disposable PostgreSQL 17.12 Suite 2 Logger Isolation 1/1 PASS & Suite 3 Isolated Contract/Concurrency/5x-Rollback 13/13 PASS; Empirical `01-init-schemas.sql` + `searchPath: ['core']` GiST Probe PASS; Real Merged Schema Suite 1 FAIL/BLOCKED at `20261122161000` on TV2 CA-01 `SQLSTATE 42830`)

---

## 1. Summary of Implemented Artifacts

### Migration Logger Helper
- `backend/core-service/db/utils/migration-logger.ts`
  - Reuses `backend/core-service/src/common/utils/logger.ts` via dynamic fallback (`../../src/common/utils/logger.js` -> `../../dist/src/common/utils/logger.js` -> matching structured JSON writer suppressed when `NODE_ENV === 'test'`).
  - Logs `Migration started`, `Migration completed` (`durationMs`), and `Migration failed` (`durationMs`, `errorCode`, `errorMessage` with hardened credential redaction covering `postgres://`/`postgresql://` URIs including `@`, `'`, or spaces in passwords without over-greedy consumption, single/double-quoted libpq values incl. escaped quotes, `authorization=Bearer`/`authorization: Bearer` tokens, JSON colon secrets, short `pwd`/`pass` keys, and unquoted `key=value`/`PGPASSWORD` secrets).

### Production Knex Migrations (`core` Schema — Reordered `20261122161000`–`20261122161400`)
Renamed from legacy `083000`–`083400` timestamps so execution order is strictly `ID-01 (20261119*) -> CA-01 (20261122160*) -> SH-01 (20261122161*) -> BO-01 (20261122170*)`:

1. `backend/core-service/db/migrations/20261122161000_create_showtimes_table.ts` — `core.showtimes` (`btree_gist` guard, `chk_showtimes_time_order`, `chk_showtimes_format`, `chk_showtimes_state`, `uq_showtimes_id_auditorium`, PG 17 `IMMUTABLE`-safe `showtime_no_room_overlap` 15-minute buffer exclusion constraint, `idx_showtime_filter` & single-column indexes).
2. `backend/core-service/db/migrations/20261122161100_create_ticket_prices_table.ts` — `core.ticket_prices` (`BIGINT` VND `>= 0`, `uq_ticket_prices_showtime_seat_type`, `idx_ticket_prices_showtime_id`).
3. `backend/core-service/db/migrations/20261122161200_create_seat_hold_groups_table.ts` — `core.seat_hold_groups` (`owner_ref` non-empty check, `expires_at > created_at`, `chk_seat_hold_groups_status_released_at`, `uq_seat_hold_groups_id_showtime`, `uq_hold_idempotency`, active expiry index).
4. `backend/core-service/db/migrations/20261122161300_create_seat_holds_table.ts` — `core.seat_holds` (composite FKs to `seat_hold_groups`, `showtimes`, and `seats`; `uq_seat_holds_group_seat`; `uq_seat_hold_active` without `NOW()`).
5. `backend/core-service/db/migrations/20261122161400_create_seat_allocations_table.ts` — `core.seat_allocations` (composite FKs to `showtimes`, `seats`, `seat_hold_groups`; `booking_id UUID NOT NULL` with deferred `BO-01` FK; `chk_seat_allocations_status_cancelled_at`; `uq_seat_allocation_active`).

### OpenAPI Specification Alignment
- `openapi/cinema-api.yaml` (`components.schemas.Showtime.properties.state.enum`): added `- cancelled` (`draft`, `on_sale`, `sales_paused`, `started`, `completed`, `cancelled`) to match `chk_showtimes_state` and `DATABASE-IMPLEMENTATION.md` §4.

### Refactored Integration Test Suite & Isolated Contract Fixtures
- `backend/core-service/tests/fixtures/ca01-bo01-provisional.ts` — Aligned with real CA-01 (`cinemas.address`, `cinemas.city`, dropped nonexistent `seat_pairs.pair_code`) and real BO-01 `core.bookings`, strictly scoped as an **isolated SH-01 contract-test fixture** pending TV2 adding `uq_auditoriums_id_cinema` and `uq_seats_id_auditorium` (never called before real `db/migrations/` `knex.migrate.latest()`).
- `backend/core-service/tests/sh01-migrations.integration.test.ts` — Split into:
  - Static migration-ordering check (`ID-01 -> CA-01 -> SH-01 -> BO-01`, 0 legacy `083*` files),
  - Logger credential-redaction regression suite (verifying `runLoggedMigration` against single/double-quoted libpq values, `Bearer` tokens, JSON colon secrets, `pwd`/`pass` short keys, unencoded quote/space DSNs, standard URIs, and anti-over-greedy matching),
  - **Suite 1 (Real Merged-Schema Verification):** runs real `db/migrations/` directly in an isolated disposable DB without stubs (honestly surfaces TV2 CA-01 `SQLSTATE 42830` if missing, and verifies full 22-migration apply + BO-01 FK + rollback/reapply once fixed),
  - **Suite 2 (Migration Logger Isolation):** verifies `runLoggedMigration` (`42P01` + credential redaction) in an isolated DB without assuming `db/migrations/` lacks CA-01,
  - **Suite 3 (Isolated SH-01 Contract & Concurrency Suite):** uses deterministic relative UTC dates (`Date.now()`-anchored, zero hardcoded `2026-12-01`..`2026-12-08`), verifies `chk_seat_hold_groups_status_released_at`, couple seat-pair integrity, real `core.bookings` row FK checks, and 2-connection concurrency races.

### Documentation Suite (`docs/SH-01/`)
- `docs/SH-01/SH01_CONTRACT_AUDIT.md`
- `docs/SH-01/SH01_DATABASE_DESIGN.md`
- `docs/SH-01/SH01_DEPENDENCIES.md`
- `docs/SH-01/SH01_TEST_REPORT.md`
- `docs/SH-01/SH01_IMPLEMENTATION_REPORT.md`

---

## 2. QA & Verification Status (Live PostgreSQL 17.12 Executed Results)

- `docker info` / `docker ps -a`: **AVAILABLE** (`DOCKER_INFO_EXIT=0`, `DOCKER_PS_EXIT=0` — Docker Desktop `29.4.3`, `postgres:17-alpine` / PostgreSQL 17.12). Disposable isolated containers were created per test run and removed in `finally`; shared `cinema-postgres` was NOT mutated.
- `npm run lint`: **PASS** (`LINT_EXIT=0`)
- `npm --workspace @cinema/core-service run typecheck`: **PASS** (`TYPECHECK_EXIT=0`)
- `npm --workspace @cinema/core-service run build`: **PASS** (`BUILD_EXIT=0`)
- `npm --workspace @cinema/core-service run test -- --reporter=verbose` (without `SH01_TEST_DATABASE_URL`): **PASS** (`TEST_EXIT=0`, `Test Files 3 passed | 1 skipped (4)`, `Tests 35 passed | 18 skipped | 1 todo (65)` — static SH-01 ordering & logger redaction regression tests passed; 15 SH-01 DB tests skipped without `SH01_TEST_DATABASE_URL`; 18 BO-01 DB tests/nested skipped without `BO01_TEST_DATABASE_URL`)
- Empirical `01-init-schemas.sql` + `searchPath: ['core']` GiST Probe (`20261122161000_create_showtimes_table.ts`): **PASS** (`PROBE_EXIT=0`) — verified `up()`, `down()`, and `re-up()` succeed cleanly when `btree_gist` is installed in `public` and `search_path = core` (`SQLSTATE 42704` does **not** occur).
- PostgreSQL 17.12 integration suite execution (`SH01_TEST_DATABASE_URL`, `tests/sh01-migrations.integration.test.ts --reporter=verbose`): **16 PASSED | 1 FAILED (17)** (`SH01_INT_EXIT=1`) — Static Ordering (`1/1 PASS`), Logger Redaction Regression (`1/1 PASS`), Suite 2 Logger Isolation (`1/1 PASS`), and Suite 3 Contract/Constraint/Concurrency/5x-Rollback (`13/13 PASS`) all passed on PostgreSQL 17.12; **Suite 1 Real Merged Schema failed at `20261122161000_create_showtimes_table.ts` (`fk_showtimes_auditorium_cinema`) exclusively with `SQLSTATE 42830` due to TV2 (`CA-01`).**

---

## 3. Risks & Open Dependencies

| Risk / Blocker | Severity | Owner & Mitigation |
|---|---|---|
| Real CA-01 migrations (`20261122160000`–`20261122160400`) omit `UNIQUE (id, cinema_id)` on `core.auditoriums` (`42830`), omit `UNIQUE (id, auditorium_id)` on `core.seats` (`42830`), use unqualified `uuid_generate_v4()` failing under `01-init-schemas.sql` + `searchPath: ['core']` (`42883`), and omit composite `(couple_pair_id, auditorium_id)` FK on `core.seats` | **Critical Blocker (`SQLSTATE 42830` / `42883`)** | **TV2 (`CA-01`)**: Add `uq_auditoriums_id_cinema` and `uq_seats_id_auditorium`, switch `uuid_generate_v4()` to `gen_random_uuid()` (or schema-qualify), and upgrade `seats.couple_pair_id` to composite FK `(couple_pair_id, auditorium_id) -> seat_pairs(id, auditorium_id)` per `SH01_DEPENDENCIES.md` §3. |
| `BO-01` migrations (`20261122170000`–`170500`) & `bo01-migrations.integration.test.ts` | **Blocked Downstream** | **TV4 (`BO-01`)**: Schema-compatible with SH-01 (`20261122161400`), blocked only until TV2 resolves `CA-01` (`42830` / `42883`). |
| D-16 showtime seed (`2026-12-20T12:30:00Z`) | **External Dependency** | **TV5 (`OP-04`)** owns D-16 seed (`IMPLEMENTATION-BACKLOG.md:29`); coordinate with TV2 `01_catalog.ts` `.del()` / `ON DELETE RESTRICT` caveat. |
| `frontend/src/features/reports/index.ts` committed to `main` in PR #5 (`f1cbc0a`) | **Low (Hygiene)** | **TV5**: Tracked on `main`; left untouched per Phase 6 safety rules and flagged for cleanup. |

---

## 4. Scope Boundary Compliance

- No teammates' production files were modified (`db/migrations/20261119*`, `db/migrations/20261122160*`, `db/migrations/20261122170*`, `tests/catalog-migrations.test.ts`, `tests/bo01-migrations.integration.test.ts`, `db/seeds/01_catalog.ts`, `db/seeds/05_concessions.ts`, `frontend/src/features/reports/index.ts`, `backend/notification-service/*`, `package.json`, `tsconfig.json` all untouched).
- No fake CA-01 or BO-01 parent tables were placed in `db/migrations/`.
- No essential FKs were dropped; no database credentials were hardcoded in source or test files.
- No Git branch switches, commits, pushes, pulls, resets, or merges were executed; `cinema-postgres` and local PG 16/18 services were not mutated.
