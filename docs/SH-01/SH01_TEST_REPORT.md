# SH-01 Test Report

**Ticket:** SH-01 (SCRUM-25)  
**Stage:** Milestone M3 Complete (Static Verification + Disposable PostgreSQL 17.12 Integration & Concurrency Suite Executed and Passed; Production `CA-01` / `BO-01` Execution Remains `BLOCKED` Pending TV2 / TV4)

---

## 1. Provisional Fixture Isolation Policy

Because TV2's `CA-01` (`core.movies`, `core.cinemas`, `core.auditoriums`, `core.seat_pairs`, `core.seats`) and TV4's `BO-01` (`core.bookings`) migrations do not yet exist in `backend/core-service/db/migrations/`:

1. Production migrations in `backend/core-service/db/migrations/` **do not** include fake parent tables and **do not** drop essential foreign keys.
2. Disposable PostgreSQL 17 integration tests provision isolated provisional parent tables exclusively via `backend/core-service/tests/fixtures/ca01-bo01-provisional.ts` inside an ephemeral `postgres:17-alpine` container (`127.0.0.1:55432:5432`) — **never** inside `db/migrations/` and **never** mutating the shared `cinema-postgres` container.
3. The integration suite (`backend/core-service/tests/sh01-migrations.integration.test.ts`) reads `process.env.SH01_TEST_DATABASE_URL` with `describe.skipIf(!process.env.SH01_TEST_DATABASE_URL)` and contains zero hardcoded credentials.
4. All tests that depend on provisional CA-01/BO-01 fixtures verify SH-01 DDL/constraints/concurrency under the documented contract and are **not** presented as full CA-01/BO-01 integration proof (`BLOCKED` on missing TV2/TV4 migrations for live production `knex migrate:latest`, explicitly proven by test `SH01-T10`).

---

## 2. QA & Build Verification (Actual Executed Checks)

| Check | Command | Exit Code | Result |
|---|---|---|---|
| Repository Lint | `npm run lint` | `0` | Passed cleanly across all files including `tests/fixtures/ca01-bo01-provisional.ts` and `tests/sh01-migrations.integration.test.ts`. |
| Core Service Typecheck | `npm --workspace @cinema/core-service run typecheck` | `0` | `tsc -p tsconfig.json --noEmit` passed with zero errors. |
| Core Service Build | `npm --workspace @cinema/core-service run build` | `0` | `tsc -p tsconfig.json` compiled cleanly. |
| Core Service Tests (without `SH01_TEST_DATABASE_URL`) | `npm --workspace @cinema/core-service run test` | `0` | `health.test.ts` (`4 passed`), `sh01-migrations.integration.test.ts` (`14 skipped`). |
| Core Service Tests (ephemeral `postgres:17-alpine` on `127.0.0.1:55432`) | `SH01_TEST_DATABASE_URL=... npm --workspace @cinema/core-service run test -- --reporter=verbose` | `0` | **18 passed (18)** across `health.test.ts` (`4`) and `sh01-migrations.integration.test.ts` (`14`) against `PostgreSQL 17.12`. |
| Ephemeral Container Cleanup | `docker rm -f sh01-ephemeral-pg17` | `0` | Verified zero remaining `sh01-ephemeral-pg17` containers (`REMAINING_SH01_CONTAINERS=`). |

---

## 3. Disposable PostgreSQL 17 Test Matrix (Actual Results)

| Test ID | Target Table / Feature | Scenario | Expected Outcome | Status |
|---|---|---|---|---|
| SH01-T01 | Migration Lifecycle (`up` / `down` / re-`up`) | Provisional CA-01 fixtures -> SH-01 `up()` -> 5x reverse `down()` -> re-`up()` on PG 17.12 | All 5 tables created cleanly (`10` rows in `core.knex_migrations`), dropped cleanly in reverse order (`5` rows left, `btree_gist` preserved), re-applied idempotently (`10` rows) | **PASS (Provisional CA-01)** |
| SH01-T02 | Schema Inspection | Inspect `information_schema.columns`, `pg_constraint`, `pg_indexes` | Verified `UUID` PKs/FKs, `TIMESTAMPTZ`, `BIGINT` `amount_vnd`, composite FKs, `showtime_no_room_overlap` (`USING gist`), `uq_seat_hold_active` (no `now()`), `uq_seat_allocation_active`, `uq_hold_idempotency` | **PASS (Provisional CA-01)** |
| SH01-T03 | `core.showtimes` Time Order & Cinema FK | Valid showtime; `ends_at <= starts_at`; cross-cinema `(auditorium_id, cinema_id)` mismatch | Valid accepted; `ends_at <= starts_at` rejected (`23514` `chk_showtimes_time_order`); cinema mismatch rejected (`23503` `fk_showtimes_auditorium_cinema`) | **PASS (Provisional CA-01)** |
| SH01-T04 | `core.showtimes` Overlap & 15m Buffer | Same auditorium: overlap, 14m gap (`12:14:00Z`), exact 15m (`12:15:00Z`), different auditorium | Overlap & 14m rejected (`23P01` `showtime_no_room_overlap`); exact 15m & different auditorium accepted | **PASS (Provisional CA-01)** |
| SH01-T05 | `core.showtimes` Concurrency | Interleaved 2-connection race & simultaneous `Promise.allSettled` race in same auditorium | Interleaved: 1 succeeds, 1 fails with `23P01` (`showtime_no_room_overlap`); simultaneous: 1 succeeds, 1 fails (`23P01` or `40P01`) | **PASS (Provisional CA-01)** |
| SH01-T06 | `core.showtimes` Cancelled/Completed Policy | Schedule active showtime overlapping `'cancelled'` and `'completed'` rows | Accepted while preserving historical rows (`4` rows retained) | **PASS (Provisional CA-01)** |
| SH01-T07 | `core.ticket_prices` | Valid `BIGINT` VND (`0`, `120000`, `150000`), negative amount (`-1000`), duplicate `(showtime_id, seat_type)` | Valid accepted as `BIGINT`; negative rejected (`23514` `chk_ticket_prices_amount_nonnegative`); duplicate rejected (`23505` `uq_ticket_prices_showtime_seat_type`) | **PASS (Provisional CA-01)** |
| SH01-T08 | `core.seat_hold_groups` & `core.seat_holds` | Auth & guest `owner_ref`, `idempotency_key` uniqueness, couple seat pair rows, `expires_at <= created_at`, duplicate seat in hold group, missing/cross-auditorium FKs, concurrent active hold race, release + re-hold | All constraints (`23514`, `23505`, `23503`) enforced; 2-connection race allows 1 winner & rejects 2nd with `23505` (`uq_seat_hold_active`); releasing frees seat for next hold | **PASS (Provisional CA-01)** |
| SH01-T09 | `core.seat_allocations` | Active allocation, duplicate active, wrong-auditorium seat, soft-cancel constraint, reallocation preserving history, 2-connection race, deferred `BO-01` FK contract | Duplicate & concurrent active rejected (`23505` `uq_seat_allocation_active`); wrong auditorium rejected (`23503`); soft-cancel preserves both rows; provisional `core.bookings` validates `fk_seat_allocations_booking` (`23503`) | **PASS (Provisional CA-01 / BO-01)** |
| SH01-T10 | Production `CA-01` / `BO-01` Blocking Check | Run production `knex.migrate.latest()` on clean DB without `core.movies` (`NODE_ENV=development`) | Fails cleanly on `20261122083000_create_showtimes_table` with SQLSTATE `42P01` (`relation "core.movies" does not exist`), emits structured JSON `Migration started` & `Migration failed` without leaking `DATABASE_URL`/passwords; `core.showtimes` not created | **PASS (Proves Production Integration `BLOCKED` Pending TV2)** |

---

## 4. Verbatim Command Outputs

### 4.1 Static QA & Baseline Test Run (without `SH01_TEST_DATABASE_URL`)

```text
> cinema-ticket-booking@0.1.0 lint
> eslint .

LINT_EXIT=0

> @cinema/core-service@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit

TYPECHECK_EXIT=0

> @cinema/core-service@0.1.0 build
> tsc -p tsconfig.json

BUILD_EXIT=0

> @cinema/core-service@0.1.0 test
> vitest run


 RUN  v3.2.7 C:/CinemaTicketBooking/backend/core-service

 ↓ tests/sh01-migrations.integration.test.ts (14 tests | 14 skipped)
 ✓ tests/health.test.ts (4 tests) 34ms

 Test Files  1 passed | 1 skipped (2)
      Tests  4 passed | 14 skipped (18)
   Start at  15:31:30
   Duration  2.75s (transform 316ms, setup 0ms, collect 3.29s, tests 34ms, environment 0ms, prepare 382ms)

TEST_SKIP_EXIT=0
```

### 4.2 Ephemeral `postgres:17-alpine` Container Execution & Cleanup

Command executed (using an ephemeral random password generated in shell and injected solely via `SH01_TEST_DATABASE_URL`, with `01-init-schemas.sql` mounted read-only):

```powershell
$ErrorActionPreference = 'Stop'
$containerName = 'sh01-ephemeral-pg17'
$pgPass = [guid]::NewGuid().ToString('N')
$initSql = (Resolve-Path 'infrastructure\docker\postgres\init\01-init-schemas.sql').Path
try {
  $existing = docker ps -aq -f "name=^${containerName}$"
  if ($existing) { docker rm -f $containerName | Out-Null }

  docker run -d --name $containerName -p 127.0.0.1:55432:5432 `
    -e POSTGRES_USER=sh01_test `
    -e POSTGRES_PASSWORD=$pgPass `
    -e POSTGRES_DB=cinema_sh01_test `
    -v "${initSql}:/docker-entrypoint-initdb.d/01-init-schemas.sql:ro" `
    postgres:17-alpine | Out-Null

  for ($i = 0; $i -lt 40; $i++) {
    docker exec $containerName pg_isready -h 127.0.0.1 -U sh01_test -d cinema_sh01_test 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }
  docker exec $containerName psql -h 127.0.0.1 -U sh01_test -d cinema_sh01_test -c "SELECT version();"
  $env:SH01_TEST_DATABASE_URL = "postgresql://sh01_test:${pgPass}@127.0.0.1:55432/cinema_sh01_test"
  npm --workspace @cinema/core-service run test -- --reporter=verbose
  $testExit = $LASTEXITCODE
  Write-Host "VITEST_PG17_EXIT=$testExit"
  if ($testExit -ne 0) { throw "Vitest failed with exit code $testExit" }
} finally {
  Remove-Item Env:SH01_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  $existingEnd = docker ps -aq -f "name=^${containerName}$"
  if ($existingEnd) { docker rm -f $containerName }
}
Write-Host "REMAINING_SH01_CONTAINERS=$(docker ps -a --filter name=$containerName --format '{{.Names}}')"
git status --short
```

Verbatim output:

```text
                                         version                                          
------------------------------------------------------------------------------------------
 PostgreSQL 17.12 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit
(1 row)


> @cinema/core-service@0.1.0 test
> vitest run --reporter=verbose


 RUN  v3.2.7 C:/CinemaTicketBooking/backend/core-service

 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > blocks production Knex migration cleanly with 42P01 and redacted JSON logs when CA-01 is absent 1439ms
 ✓ tests/health.test.ts > core-service — Smoke & Infrastructure Tests > GET /health returns 200 OK with service and schema metadata 28ms
 ✓ tests/health.test.ts > core-service — Smoke & Infrastructure Tests > propagates incoming x-request-id header on GET /api/v1/health/live 7ms
 ✓ tests/health.test.ts > core-service — Smoke & Infrastructure Tests > returns standard 404 error envelope for unknown routes 4ms
 ✓ tests/health.test.ts > core-service — Smoke & Infrastructure Tests > validates database, redis, module boundaries, and environment configuration defaults 1ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > executes full Knex up(), reverse down() rollback, and re-up() cleanly with provisional CA-01 fixtures 964ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > verifies PostgreSQL 17 columns, data types, constraints, and indexes via system catalogs 53ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > Functional & Concurrency Enforcement > core.showtimes > accepts valid showtimes and rejects ends_at <= starts_at and cross-cinema auditorium mismatch 45ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > Functional & Concurrency Enforcement > core.showtimes > enforces 15-minute auditorium buffer (rejects overlap & 14m gap, accepts exact 15m & different auditorium) 41ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > Functional & Concurrency Enforcement > core.showtimes > prevents concurrent conflicting showtime inserts across two DB connections (1 succeeds, 1 fails 23P01 / deadlock) 1126ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > Functional & Concurrency Enforcement > core.showtimes > allows rescheduling over cancelled and completed showtimes while preserving history 58ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > Functional & Concurrency Enforcement > core.ticket_prices > accepts non-negative BIGINT VND prices and rejects negative amounts and duplicate (showtime_id, seat_type) 51ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > Functional & Concurrency Enforcement > core.seat_hold_groups & core.seat_holds > supports authenticated & guest hold groups, idempotency_key uniqueness, and couple seat rows 56ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > Functional & Concurrency Enforcement > core.seat_hold_groups & core.seat_holds > rejects invalid expiration, duplicate seat in same hold group, and invalid/cross-auditorium FKs 64ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > Functional & Concurrency Enforcement > core.seat_hold_groups & core.seat_holds > prevents concurrent active hold inserts for the same (showtime_id, seat_id) across two connections (23505) 69ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > Functional & Concurrency Enforcement > core.seat_allocations > rejects duplicate active allocation, wrong-auditorium seat, and allows reallocation after soft cancellation 56ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > Functional & Concurrency Enforcement > core.seat_allocations > prevents concurrent duplicate active allocations across two connections (1 succeeds, 1 fails 23505) 57ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency > Functional & Concurrency Enforcement > core.seat_allocations > validates the deferred BO-01 fk_seat_allocations_booking contract using provisional core.bookings 91ms

 Test Files  2 passed (2)
      Tests  18 passed (18)
   Start at  15:31:46
   Duration  5.54s (transform 207ms, setup 0ms, collect 2.83s, tests 4.35s, environment 0ms, prepare 316ms)

VITEST_PG17_EXIT=0
sh01-ephemeral-pg17
REMAINING_SH01_CONTAINERS=
?? backend/core-service/db/migrations/20261122083000_create_showtimes_table.ts
?? backend/core-service/db/migrations/20261122083100_create_ticket_prices_table.ts
?? backend/core-service/db/migrations/20261122083200_create_seat_hold_groups_table.ts
?? backend/core-service/db/migrations/20261122083300_create_seat_holds_table.ts
?? backend/core-service/db/migrations/20261122083400_create_seat_allocations_table.ts
?? backend/core-service/db/utils/
?? backend/core-service/tests/fixtures/
?? backend/core-service/tests/sh01-migrations.integration.test.ts
?? docs/SH-01/
?? frontend/src/features/reports/
```
