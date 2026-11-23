# SH-01 Contract & Repository Audit

**Ticket:** SH-01 (SCRUM-25) — Database Migrations for Showtime, Pricing, Seat Holding, and Seat Allocation  
**Service / Schema:** `@cinema/core-service` (`backend/core-service/`, PostgreSQL schema `core`)  
**Initial Audit Date:** 2026-11-22 | **Post-Merge Remediation Date:** 2026-11-23
**Branch State:** `fix/SH-01-integration` (branched from `main` at `f1cbc0a`; `frontend/src/features/reports/index.ts` was committed to `main` in `ba194c7`/`f1cbc0a` and is preserved untouched as a TV5 ownership hygiene issue)

---

## 1. Repository Structure & Runtime Stack Audit

| Area | Observed Path / Config | Findings |
|---|---|---|
| Workspace Root | `package.json` | Monorepo with workspaces: `packages/{eslint-config,shared-types,shared-utils,api-contracts}`, `backend/{core-service,payment-service,notification-service}`, `frontend`. Node `>=22.0.0` (verified runtime `v24.11.0`), ESLint `^9.17.0`, TypeScript `^5.7.2`, `tsx ^4.19.2`, Vitest `^3.2.4`. |
| Core Service | `backend/core-service/package.json` | `"type": "module"`, Express `^5.0.1`, Knex `^3.3.0`, `pg ^8.13.1`, Zod `^3.24.1`. `ts-node` is declared in `devDependencies` (`^10.9.2`) but **not installed** in `node_modules`; `tsx` is installed at root `node_modules/tsx`. |
| TypeScript Config | `tsconfig.base.json`, `backend/core-service/tsconfig.json` | Strict ESM (`"module": "NodeNext"`, `"moduleResolution": "NodeNext"`). `core-service` `tsconfig.json` includes `["src/**/*.ts", "tests/**/*.ts", "knexfile.ts"]` (excludes `db/**/*.ts` from `dist/` build, while root `eslint.config.js` lints all `**/*.ts`). |
| Knex Config | `backend/core-service/knexfile.ts` | Client `'pg'`, `searchPath: [dbSchema]` (default `'core'`), `migrations: { directory: './db/migrations', schemaName: dbSchema, tableName: 'knex_migrations', extension: 'ts' }`. |
| PG Schema Init | `infrastructure/docker/postgres/init/01-init-schemas.sql`, `docker-compose.yml` | `postgres:17-alpine` (`TZ: UTC`), creates `core`, `payment`, `notification` schemas and extensions `"uuid-ossp"`, `"btree_gist"`. Explicitly forbids cross-schema FKs (`D-04`). |
| Merged Core Migrations | `backend/core-service/db/migrations/` | 22 migrations in chronological order: ID-01 (`20261119153810`–`20261119153952`, TV1), CA-01 (`20261122160000`–`20261122160500`, TV2), SH-01 (`20261122161000`–`20261122161400`, TV3), BO-01 (`20261122170000`–`20261122170500`, TV4). |
| Existing Notification Migration | `backend/notification-service/db/migrations/20261120152500_create_notification_tables.ts` | TV5 (`OP-02`) migration uses `UUID` PKs (`gen_random_uuid()`), `timestamp(..., { useTz: true })`, `dropTableIfExists`, and `idx_*` naming. |
| Existing Payment Migrations | `backend/payment-service/db/migrations/` | Contains only `.gitkeep`. |
| Module Scaffolds | `backend/core-service/src/modules/{showtimes,pricing,seat-holds}/index.ts` | Placeholder `ModuleDescriptor` exports only; no runtime CRUD/API logic implemented yet. |

---

## 2. Database Conventions & Authoritative Specifications

Authoritative sources: `docs/DECISIONS.md` (`D-04`..`D-18`), `docs/01-requirements/BUSINESS-RULES.md`, `docs/02-architecture/ERD.md`, `docs/02-architecture/DATABASE-IMPLEMENTATION.md`, `docs/02-architecture/DESIGN-REVIEW.md`, `docs/02-architecture/CONTRACT-MATRIX.md`, `docs/diagrams/erd-detailed.mmd`, `docs/diagrams/seat-state.mmd`, and `openapi/cinema-api.yaml`.

| Convention | Authoritative Rule | SH-01 Implementation |
|---|---|---|
| Primary & Foreign Keys | `UUID` (`defaultTo(knex.raw('gen_random_uuid()'))`) | All 5 SH-01 tables use `UUID` PKs and `UUID` FKs. |
| Timestamps | UTC `TIMESTAMPTZ` (`D-18`), stored in UTC, displayed as `Asia/Ho_Chi_Minh` | All timestamp columns use `table.timestamp(..., { useTz: true })` (`TIMESTAMPTZ`). |
| Monetary Values | Non-negative integer VND (`BIGINT CHECK (amount_vnd >= 0)`) (`D-18`), never floating-point | `core.ticket_prices.amount_vnd` uses `BIGINT NOT NULL` + `CHECK (amount_vnd >= 0)`. |
| Schema & Naming | Schema `core`, English `snake_case`, plural tables, `fk_*`/`chk_*`/`uq_*`/`idx_*` constraints, `YYYYMMDDHHMMSS_*.ts` filenames | All SH-01 DDL uses explicit `core.*` schema qualification via `knex.schema.withSchema('core')` and schema-qualified `.inTable('core.*')` / raw SQL. |
| Cross-Schema Isolation | Zero cross-schema foreign keys (`D-04`, `CT-18`) | SH-01 creates zero FKs referencing `payment.*` or `notification.*`. |
| OpenAPI Showtime Lifecycle | `Showtime.state` supports `'draft'`, `'on_sale'`, `'sales_paused'`, `'started'`, `'completed'`, `'cancelled'` | `openapi/cinema-api.yaml` (`components.schemas.Showtime.properties.state.enum`) updated to include `'cancelled'` matching `chk_showtimes_state`. |

---

## 3. TV1 `ID-01` Divergence Audit

Inspecting TV1's merged migrations (`20261119153810_create_roles_table.ts` through `20261119153952_create_password_resets_table.ts`) revealed a convention divergence from `ERD.md` and `openapi/cinema-api.yaml`:

- `roles.id` and `users.id` were created with `table.increments('id').primary()` (`INTEGER`/`SERIAL`) instead of `UUID`.
- `users.cinema_id` was created as `table.integer('cinema_id').nullable()` (later migrated to `UUID` FK -> `cinemas(id)` by TV2 `20261122160500_add_users_cinema_fk.ts`).
- Table names (`'roles'`, `'users'`, etc.) were unqualified rather than `core.*` (relying on `searchPath: ['core']`).

**Impact on SH-01:**
1. SH-01 **must** follow the ratified `UUID` convention across `ERD.md`, `OpenAPI 3.1`, `OP-02`, and `CA-01`/`BO-01` contracts — never `INTEGER`/`BIGINT` IDs.
2. `core.seat_hold_groups` uses `owner_ref VARCHAR(255) NOT NULL` (matching `ERD.md` §2.1 and `DATABASE-IMPLEMENTATION.md` §3, e.g., `user:<id>` or `guest:<sessionHash>`) rather than a type-mismatched `UUID` foreign key to TV1's `INTEGER` `core.users(id)`.
3. TV1's existing files (`20261119*`) are untouched per scope boundaries.

---

## 4. Logging & ESM Loader Audit

- `backend/core-service/src/common/utils/logger.ts` implements a custom structured JSON logger (`logger.info`, `logger.warn`, `logger.error`) writing `{ timestamp, level, service, schema, message, ...context }` (using `toUtcIsoString()` from `@cinema/shared-utils`), suppressed when `NODE_ENV === 'test'`.
- Neither `pino` nor `pino-http` is installed in `backend/core-service/package.json`; per R3, `pino` is **not** added.
- **Loader hazard resolved:** `logger.ts` imports `../../config/env.js` (TypeScript `NodeNext` specifier). Under plain Node 24 native `.ts` stripping (when running `knex --knexfile knexfile.ts migrate:latest` without `--import tsx` and without compiled `dist/`), static runtime imports of `src/common/utils/logger.js` fail with `ERR_MODULE_NOT_FOUND`.
- **Solution implemented (`backend/core-service/db/utils/migration-logger.ts`):**
  1. Dynamically imports `../../src/common/utils/logger.js` (succeeds under `tsx` / Vitest),
  2. Falls back to `../../dist/src/common/utils/logger.js` (succeeds in compiled Docker builds),
  3. Falls back to an identical structured JSON writer (suppressed when `NODE_ENV === 'test'`).
  4. Emits `Migration started`, `Migration completed` (`durationMs`), and `Migration failed` (`durationMs`, `errorCode`, `errorMessage` with URI/secret redaction) with zero passwords, tokens, or PII.

---

## 5. Post-Merge Contract Verification for TV2 (`CA-01`), TV4 (`BO-01`), and TV5 (`OP-04`)

### TV2 (`CA-01`: `20261122160000`–`20261122160500`, commit `827081d`)
1. **Migration Timestamp Window — RESOLVED BY SH-01 RENAME:** CA-01 merged at `20261122160000`–`20261122160500`. SH-01 was renamed from legacy `083000`–`083400` to `20261122161000`–`20261122161400` so execution order is strictly `ID-01 -> CA-01 -> SH-01 -> BO-01`.
2. **Composite Unique Keys — CRITICAL TV2 BLOCKER (`SQLSTATE 42830`):**
   - `20261122160200_create_auditoriums_table.ts` defines `uq_auditoriums_cinema_name UNIQUE (cinema_id, name)` but **omits `UNIQUE (id, cinema_id)`**. `20261122161000_create_showtimes_table.ts` requires `core.auditoriums(id, cinema_id)` for `fk_showtimes_auditorium_cinema`.
   - `20261122160400_create_seats_table.ts` defines `uq_seats_auditorium_position` but **omits `UNIQUE (id, auditorium_id)`**. `20261122161300_create_seat_holds_table.ts` (`fk_seat_holds_seat_auditorium`) and `20261122161400_create_seat_allocations_table.ts` (`fk_seat_allocations_seat_auditorium`) require `core.seats(id, auditorium_id)`.
   - PostgreSQL rejects all three composite FKs with `SQLSTATE 42830` (`there is no unique constraint matching given keys for referenced table`) until TV2 adds those two constraints.
3. **Catalog Schema Alignment (`cinemas` / `seat_pairs`):**
   - Real `core.cinemas` includes `address NOT NULL` and `city NOT NULL`.
   - Real `core.seat_pairs` does **not** have a `pair_code` column.
   - `tests/fixtures/ca01-bo01-provisional.ts` has been aligned to match real CA-01 columns while retaining the two missing composite unique constraints solely for isolated SH-01 contract tests.

### TV4 (`BO-01`: `20261122170000`–`20261122170500`, commit `8377a47`)
1. **Deferred `fk_seat_allocations_booking` — VERIFIED COMPATIBLE:** `20261122170500_add_seat_allocations_booking_fk.ts` adds `fk_seat_allocations_booking` (`booking_id -> core.bookings(id) ON DELETE RESTRICT`) in `up()` and drops it in `down()`, running strictly after SH-01 (`20261122161400`).
2. **Hold Status & Ownership — VERIFIED COMPATIBLE:** `core.bookings.hold_group_id` references `core.seat_hold_groups(id)` (`ON DELETE RESTRICT`); SH-01 `owner_ref VARCHAR(255)` and hold statuses `('active', 'confirmed', 'released', 'expired')` align cleanly.
3. **Downstream Status:** BO-01 migrations (`20261122170000`–`170500`) and `tests/bo01-migrations.integration.test.ts` (which runs real merged `db/migrations/`) are blocked downstream only until TV2 fixes CA-01 (`SQLSTATE 42830`).

### TV5 (`OP-04` D-16 Seed & Hygiene)
1. **D-16 Showtime Seed (`2026-12-20T12:30:00Z`):** Assigned to `OP-04` (TV5) per `docs/04-delivery/IMPLEMENTATION-BACKLOG.md:29`. SH-01 does not create an `OP-04` seed file. Note that `backend/core-service/db/seeds/01_catalog.ts` (TV2) currently executes `.del()` across catalog tables, which will hit `ON DELETE RESTRICT` (`23503`) if showtime rows already exist.
2. **Merged Hygiene Artifact:** `frontend/src/features/reports/index.ts` (`REPORTS_FEATURE_OWNER = 'TV5'`) was introduced in `ba194c7` and merged to `main` via `f1cbc0a`; per repository policy it is not silently deleted in SH-01 remediation and is reported as a TV5 ownership cleanup item.
