# SH-01 Test Report

**Ticket:** SH-01 (SCRUM-25)  
**Stage:** Post-Merge Remediation Final Validation (Static Checks, Ordering `1/1` PASS, Logger Redaction Hardening `1/1` PASS; Disposable PostgreSQL 17.12 Suite Executed: Suite 2 Logger Isolation `1/1` PASS, Suite 3 Contract/Concurrency/5x-Rollback `13/13` PASS, Empirical `01-init-schemas.sql` + `searchPath: ['core']` `20261122161000` GiST Probe PASS; Suite 1 Real Merged-Schema FAIL/BLOCKED at `20261122161000` with `SQLSTATE 42830` due to TV2 `CA-01`)

---

## 1. Post-Merge Test Architecture & Isolation Policy

Following the post-merge remediation of `backend/core-service/tests/sh01-migrations.integration.test.ts`, `backend/core-service/tests/fixtures/ca01-bo01-provisional.ts`, and credential-redaction hardening in `backend/core-service/db/utils/migration-logger.ts`:

1. **Static Repository Ordering & Logger Redaction Checks (Always Run):**
   - Verifies `db/migrations/` sorts strictly as `ID-01 (20261119*) -> CA-01 (20261122160*) -> SH-01 (20261122161000–161400) -> BO-01 (20261122170*)` with zero legacy `083*` migration files.
   - Verifies `runLoggedMigration` redacts single/double-quoted libpq values (including escaped quotes), `authorization=Bearer`/`authorization: Bearer` tokens, JSON colon secrets with optional whitespace, short `pwd`/`pass` keys, and `postgres://`/`postgresql://` DSNs containing unencoded quotes or spaces in passwords alongside standard URIs and unquoted `key=value`/`PGPASSWORD` secrets without over-greedy cross-line/multi-URI consumption.
2. **Suite 1 — Real Merged-Schema Migration Verification (Zero Provisional Stubs):** Runs `knex.migrate.latest()` directly against `db/migrations/` inside a fresh isolated disposable database (`sh01_merged_*`) with **zero** calls to `provisionProvisionalCa01Tables` or `provisionProvisionalBo01Tables` (eliminating `42P07` and protecting real `core.bookings`). Because TV2 `CA-01` still omits `uq_auditoriums_id_cinema` / `uq_seats_id_auditorium` (and relies on unqualified `uuid_generate_v4()` under `01-init-schemas.sql` + `searchPath: ['core']`), Suite 1 **fails honestly** at `20261122161000_create_showtimes_table.ts` surfacing the `SQLSTATE 42830` TV2 blocker rather than silently skipping or faking pass status. Once TV2 fixes CA-01, it verifies all 22 migrations, `fk_seat_allocations_booking` against a real `core.bookings` row, and rollback/re-apply.
3. **Suite 2 — Migration Logger Isolation:** Runs `20261122161000_create_showtimes_table` in a separate isolated database (`sh01_logger_*`) lacking `core.movies` via an in-memory Knex `MigrationSource` so `runLoggedMigration` (`SQLSTATE 42P01` + `DATABASE_URL`/password redaction) is verified against PostgreSQL without assuming `db/migrations/` is unmerged.
4. **Suite 3 — Isolated SH-01 Contract, Constraint & Concurrency Suite:** Runs in its own isolated disposable database (`sh01_contract_*`) loading only the 5 real SH-01 migration files (`20261122161000`–`20261122161400`) alongside contract-aligned `ca01-bo01-provisional.ts` fixtures. All hardcoded `2026-12-01`..`2026-12-08` dates were replaced with deterministic relative UTC dates (`BASE_UTC_MIDNIGHT_MS` + offsets, and `Date.now() + offset` for DB-default `created_at` hold expirations). **This suite tests SH-01 contract behavior in isolation and is NOT claimed as real integrated-schema proof while TV2 `CA-01` blockers remain open.**

---

## 2. QA & Build Verification (Live PostgreSQL 17.12 Execution)

| Check | Command | Exit Code | Result |
|---|---|---|---|
| Docker Desktop Availability | `docker info` / `docker ps -a` | `0` | **AVAILABLE** — Docker Desktop `29.4.3`, `postgres:17-alpine` (`PostgreSQL 17.12`). Disposable isolated containers used and removed in `finally`; shared `cinema-postgres` untouched. |
| Repository Lint | `npm run lint` | `0` | **PASS** — `eslint .` passed cleanly across all workspace files. |
| Core Service Typecheck | `npm --workspace @cinema/core-service run typecheck` | `0` | **PASS** — `tsc -p tsconfig.json --noEmit` passed with zero errors. |
| Core Service Build | `npm --workspace @cinema/core-service run build` | `0` | **PASS** — `tsc -p tsconfig.json` compiled cleanly. |
| Core Service Tests (without `SH01_TEST_DATABASE_URL`) | `npm --workspace @cinema/core-service run test -- --reporter=verbose` | `0` | **PASS** — `Test Files 3 passed \| 1 skipped (4)`; `Tests 35 passed \| 18 skipped \| 1 todo (65)` (`catalog-migrations.test.ts` 29 passed; `health.test.ts` 4 passed; `sh01-migrations.integration.test.ts` 1 static ordering + 1 logger redaction regression passed, 15 DB tests skipped without `SH01_TEST_DATABASE_URL`; `bo01-migrations.integration.test.ts` skipped without `BO01_TEST_DATABASE_URL`). |
| Empirical `01-init-schemas.sql` + `searchPath: ['core']` GiST Probe (`20261122161000`) | Disposable `postgres:17-alpine` initialized with `01-init-schemas.sql` (`btree_gist` in `public`) + Knex `searchPath: ['core']` | `0` | **PASS** — `20261122161000_create_showtimes_table.ts` `up()`, `down()`, and `re-up()` all succeeded cleanly (`SQLSTATE 42704` did **not** occur because `auditorium_id WITH =` resolves PostgreSQL's default `uuid` GiST opclass directly). |
| Disposable PG 17.12 Integration Suite (`SH01_TEST_DATABASE_URL`) | `npm --workspace @cinema/core-service run test -- tests/sh01-migrations.integration.test.ts --reporter=verbose` | `1` | **16 PASSED \| 1 FAILED (17)** — Static Ordering `1/1 PASS`, Logger Redaction Regression `1/1 PASS`, Suite 2 Logger Isolation `1/1 PASS`, Suite 3 Contract/Concurrency/5x-Rollback `13/13 PASS`; **Suite 1 Real Merged Schema `FAIL/BLOCKED` at `20261122161000` with `SQLSTATE 42830` (`fk_showtimes_auditorium_cinema`) due to TV2 `CA-01`.** |

---

## 3. PostgreSQL 17.12 Test Matrix (Actual Results)

| Test Area | Suite | Target / Scenario | Observed Outcome on PostgreSQL 17.12 | Status |
|---|---|---|---|---|
| SH01-ORD-01 | Static | Lexicographical order in `db/migrations/` (`ID-01 -> CA-01 -> SH-01 -> BO-01`), zero legacy `083*` files | Passed statically via `readdirSync` (`5ms`) | **PASS** |
| SH01-LOG-REDACT | Unit / Logger | `runLoggedMigration` redaction across quoted libpq values, `Bearer` tokens (`=`/`:`), JSON colon secrets, `pwd`/`pass` short keys, unencoded `'`/space DSN passwords, standard URIs, and anti-over-greedy multi-URI/email cases | All 9 adversarial cases redacted cleanly without over-greedy consumption (`8ms`) | **PASS** |
| SH01-REAL-01 | Suite 1 (Real Merged) | `knex.migrate.latest()` on real `db/migrations/` without stubs | ID-01 & CA-01 applied; failed at `20261122161000_create_showtimes_table.ts` (`fk_showtimes_auditorium_cinema`) with **`SQLSTATE 42830`** because TV2 `CA-01` omits `uq_auditoriums_id_cinema` / `uq_seats_id_auditorium` | **FAIL / BLOCKED (TV2 `42830`)** |
| SH01-LOG-01 | Suite 2 (Logger Isolation) | Single-migration `20261122161000` run in isolated DB without `core.movies` | Exit/failure `42P01`, structured JSON `Migration started`/`Migration failed`, redacted `DATABASE_URL` & password, rollback verified | **PASS** |
| SH01-T01 | Suite 3 (Contract) | SH-01 `up()`, 5x reverse `down()`, re-`up()` (`20261122161000`–`161400`) + `btree_gist` preservation | 5 SH-01 tables created, rolled back in reverse order, and re-created cleanly | **PASS** |
| SH01-T02 | Suite 3 (Contract) | System catalog inspection (`columns`, `pg_constraint` incl. `chk_seat_hold_groups_status_released_at`, `pg_indexes`) | All types, constraints, and partial/GiST indexes verified | **PASS** |
| SH01-T03..T06 | Suite 3 (Contract) | `core.showtimes` time order, cinema-room FK, 15m turnaround buffer & exact boundary, different auditorium, 2-conn concurrency, cancelled/completed reschedule (relative UTC dates) | `23514`, `23503`, `23P01`/`40P01` enforced; cancelled/completed rescheduling allowed (`4/4` tests) | **PASS** |
| SH01-T07 | Suite 3 (Contract) | `core.ticket_prices` `BIGINT` VND (`0`, `9007199254740993`, `150000`), negative check, uniqueness | `23505` & `23514` enforced | **PASS** |
| SH01-T08..T08L | Suite 3 (Contract) | `core.seat_hold_groups` & `core.seat_holds`: auth/guest `owner_ref`, idempotency, couple seat-pair integrity, `chk_seat_hold_groups_status_released_at` (`active`/`released`/`confirmed`/`expired`), expiry checks, cross-auditorium FKs, 2-conn active hold race, release + re-hold (relative UTC dates) | `23514`, `23505`, `23503` enforced (`4/4` tests) | **PASS** |
| SH01-T09 | Suite 3 (Contract) | `core.seat_allocations`: real `core.bookings` row FK + invalid `booking_id` `23503`, duplicate active, wrong-auditorium seat, soft-cancel constraint & reallocation, 2-conn race | `23505`, `23503`, `23514` enforced (`2/2` tests) | **PASS** |

---

## 4. Verbatim Command Outputs (Live PG 17.12 Validation Run)

```text
PostgreSQL 17.12 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit

=== SH-01 INTEGRATION SUITE (WITH SH01_TEST_DATABASE_URL) ===
> @cinema/core-service@0.1.0 test
> vitest run tests/sh01-migrations.integration.test.ts --reporter=verbose

 ✓ tests/sh01-migrations.integration.test.ts > SH-01 Migration File Ordering (Static Repository Verification) > orders migrations strictly as ID-01 -> CA-01 -> SH-01 -> BO-01 with zero legacy 20261122083* files 5ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 Migration Logger Credential Redaction > redacts quoted libpq values, Bearer tokens, JSON secrets, short pwd/pass keys, and unencoded-quote/space DSNs without over-greedy matching 8ms
 × tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 1. Real Merged-Schema Migration Verification (ID-01 -> CA-01 -> SH-01 -> BO-01) > runs real db/migrations/ cleanly without provisional stubs and verifies order, rollback/reapply, and BO-01 FK compatibility 480ms
   → EXTERNAL TV2 CA-01 BLOCKER (SQLSTATE 42830): Real CA-01 migrations (20261122160200_create_auditoriums_table.ts / 20261122160400_create_seats_table.ts) are missing UNIQUE (id, cinema_id) and/or UNIQUE (id, auditorium_id) required by SH-01 composite FKs. Original error: alter table "core"."showtimes" add constraint "fk_showtimes_auditorium_cinema" foreign key ("auditorium_id", "cinema_id") references "core"."auditoriums" ("id", "cinema_id") on delete RESTRICT - there is no unique constraint matching given keys for referenced table "auditoriums"
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 2. Migration Logger Isolation (runLoggedMigration 42P01 & Redaction) > logs structured JSON failure with 42P01 and redacts DATABASE_URL/password when upstream parent table is absent 1208ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > executes SH-01 up(), 5x reverse down() rollback, and re-up() cleanly against contract CA-01 fixtures 609ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > verifies PostgreSQL 17 columns, data types, constraints, and indexes via system catalogs 18ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > Functional & Concurrency Enforcement > core.showtimes > accepts valid showtimes and rejects ends_at <= starts_at and cross-cinema auditorium mismatch 32ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > Functional & Concurrency Enforcement > core.showtimes > enforces 15-minute auditorium buffer (rejects overlap & 14m gap, accepts exact 15m & different auditorium) 39ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > Functional & Concurrency Enforcement > core.showtimes > prevents concurrent conflicting showtime inserts across two DB connections (1 succeeds, 1 fails 23P01 / deadlock) 1160ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > Functional & Concurrency Enforcement > core.showtimes > allows rescheduling over cancelled and completed showtimes while preserving history 170ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > Functional & Concurrency Enforcement > core.ticket_prices > accepts non-negative BIGINT VND prices and rejects negative amounts and duplicate (showtime_id, seat_type) 31ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > Functional & Concurrency Enforcement > core.seat_hold_groups & core.seat_holds > supports authenticated & guest hold groups, idempotency_key uniqueness, and couple seat-pair integrity 47ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > Functional & Concurrency Enforcement > core.seat_hold_groups & core.seat_holds > enforces chk_seat_hold_groups_status_released_at lifecycle invariants 49ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > Functional & Concurrency Enforcement > core.seat_hold_groups & core.seat_holds > rejects invalid expiration, duplicate seat in same hold group, and invalid/cross-auditorium FKs 76ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > Functional & Concurrency Enforcement > core.seat_hold_groups & core.seat_holds > prevents concurrent active hold inserts for the same (showtime_id, seat_id) across two connections (23505) 81ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > Functional & Concurrency Enforcement > core.seat_allocations > rejects duplicate active allocation, wrong-auditorium seat, invalid booking_id FK, and allows reallocation after soft cancellation 101ms
 ✓ tests/sh01-migrations.integration.test.ts > SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration > 3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01) > Functional & Concurrency Enforcement > core.seat_allocations > prevents concurrent duplicate active allocations across two connections (1 succeeds, 1 fails 23505) 102ms

 Test Files  1 failed (1)
      Tests  1 failed | 16 passed (17)
SH01_INT_EXIT=1
```
