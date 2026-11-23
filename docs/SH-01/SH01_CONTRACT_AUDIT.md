# SH-01 Contract & Repository Audit

**Ticket:** SH-01 (SCRUM-25) — Database Migrations for Showtime, Pricing, Seat Holding, and Seat Allocation  
**Service / Schema:** `@cinema/core-service` (`backend/core-service/`, PostgreSQL schema `core`)  
**Audit Date:** 2026-11-22  
**Branch State:** `TV3Hoàng` (user-approved exception to R1's `feature/SH-01-showtime-migrations` check; untracked `frontend/src/features/reports/index.ts` preserved untouched)

---

## 1. Repository Structure & Runtime Stack Audit

| Area | Observed Path / Config | Findings |
|---|---|---|
| Workspace Root | `package.json` | Monorepo with workspaces: `packages/{eslint-config,shared-types,shared-utils,api-contracts}`, `backend/{core-service,payment-service,notification-service}`, `frontend`. Node `>=22.0.0` (verified runtime `v24.11.0`), ESLint `^9.17.0`, TypeScript `^5.7.2`, `tsx ^4.19.2`, Vitest `^3.2.4`. |
| Core Service | `backend/core-service/package.json` | `"type": "module"`, Express `^5.0.1`, Knex `^3.3.0`, `pg ^8.13.1`, Zod `^3.24.1`. `ts-node` is declared in `devDependencies` (`^10.9.2`) but **not installed** in `node_modules`; `tsx` is installed at root `node_modules/tsx`. |
| TypeScript Config | `tsconfig.base.json`, `backend/core-service/tsconfig.json` | Strict ESM (`"module": "NodeNext"`, `"moduleResolution": "NodeNext"`). `core-service` `tsconfig.json` includes `["src/**/*.ts", "tests/**/*.ts", "knexfile.ts"]` (excludes `db/**/*.ts` from `dist/` build, while root `eslint.config.js` lints all `**/*.ts`). |
| Knex Config | `backend/core-service/knexfile.ts` | Client `'pg'`, `searchPath: [dbSchema]` (default `'core'`), `migrations: { directory: './db/migrations', schemaName: dbSchema, tableName: 'knex_migrations', extension: 'ts' }`. |
| PG Schema Init | `infrastructure/docker/postgres/init/01-init-schemas.sql`, `docker-compose.yml` | `postgres:17-alpine` (`TZ: UTC`), creates `core`, `payment`, `notification` schemas and extensions `"uuid-ossp"`, `"btree_gist"`. Explicitly forbids cross-schema FKs (`D-04`). |
| Existing Core Migrations | `backend/core-service/db/migrations/20261119153810..20261119153952` | Five TV1 (`ID-01`) migrations (`roles`, `users`, `email_verifications`, `refresh_tokens`, `password_resets`). CA-01 (`movies`, `cinemas`, `auditoriums`, `seat_pairs`, `seats`) and BO-01 (`bookings`, etc.) migrations do **not** exist yet. |
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

---

## 3. TV1 `ID-01` Divergence Audit

Inspecting TV1's merged migrations (`20261119153810_create_roles_table.ts` through `20261119153952_create_password_resets_table.ts`) revealed a convention divergence from `ERD.md` and `openapi/cinema-api.yaml`:

- `roles.id` and `users.id` were created with `table.increments('id').primary()` (`INTEGER`/`SERIAL`) instead of `UUID`.
- `users.cinema_id` was created as `table.integer('cinema_id').nullable()` (with its FK commented out) instead of `UUID`.
- Table names (`'roles'`, `'users'`, etc.) were unqualified rather than `core.*`.

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

## 5. Exact Contract Questions for TV2 (`CA-01`) and TV4 (`BO-01`)

### Questions for TV2 (`CA-01`: `movies`, `cinemas`, `auditoriums`, `seat_pairs`, `seats`)
1. **UUID PK/FK Confirmation & `users.cinema_id` Alignment:** Confirm all 5 CA-01 tables use `UUID` PKs/FKs (`gen_random_uuid()`), and clarify whether TV1's `users.cinema_id` (`INTEGER` in `20261119153918_create_users_table.ts`) will be migrated to `UUID` to match `core.cinemas(id)`.
2. **Composite Unique Keys for Declarative Auditorium Integrity:** Confirm `core.auditoriums` will declare `CONSTRAINT uq_auditoriums_id_cinema UNIQUE (id, cinema_id)` and `core.seats` will declare `CONSTRAINT uq_seats_id_auditorium UNIQUE (id, auditorium_id)` (mirroring `core.seat_pairs` `UNIQUE (id, auditorium_id)` in `DATABASE-IMPLEMENTATION.md` §2) so SH-01's composite FKs execute cleanly.
3. **Migration Timestamp Window:** Confirm CA-01 migrations will be timestamped strictly in `20261119160000`–`20261122082959` (before SH-01 `20261122083000`).
4. **Exact Column & Type Contract:** Confirm `core.movies(id UUID, duration_min INTEGER > 0, status)`, `core.cinemas(id UUID)`, `core.auditoriums(id UUID, cinema_id UUID, supported_formats TEXT[]/JSONB with '2D'|'3D'|'IMAX')`, and `core.seats(id UUID, auditorium_id UUID, seat_type CHECK ('standard','vip','couple'), couple_pair_id UUID NULL, is_active BOOLEAN)`.
5. **`core.showtimes.cinema_id` Alignment:** Confirm `SH-02` / `CA-01` expects `cinema_id` on `core.showtimes` (matching `ERD.md` §2.1 & `idx_showtime_filter(cinema_id, starts_at, state)`).

### Questions for TV4 (`BO-01`: `bookings`, `booking_seats`, `concessions`, `booking_concessions`, `tickets`, `payment.*`)
1. **Deferred `fk_seat_allocations_booking` Execution:** Confirm BO-01 migrations will be timestamped strictly `> 20261122083400` and will execute `ALTER TABLE core.seat_allocations ADD CONSTRAINT fk_seat_allocations_booking FOREIGN KEY (booking_id) REFERENCES core.bookings(id) ON DELETE RESTRICT` (and drop it in `down()`) right after creating `core.bookings(id UUID PK, hold_group_id UUID REFERENCES core.seat_hold_groups(id))`.
2. **Hold Status Enum Alignment:** Confirm `BO-01` uses `core.seat_hold_groups.status` and `core.seat_holds.status` values `('active', 'confirmed', 'released', 'expired')`, keeping holds `'active'` while a booking is `'pending_payment'`.
3. **Hold Ownership Field (`owner_ref`):** Confirm `BO-01` / `SH-03` will read/write `core.seat_hold_groups.owner_ref VARCHAR(255)` (e.g., `user:<id>` or `guest:<sessionHash>`) rather than expecting a `UUID` FK to `core.users(id)`.
4. **Couple Seat Price Granularity:** Confirm `core.ticket_prices.amount_vnd` for `seat_type = 'couple'` stores the price **per physical `seat_id`** (so 1 couple pair = 2 `seat_id` rows = `2 * amount_vnd` matching `booking_seats.unit_price_vnd`).
5. **Cancellation & Ticket Linkage:** Confirm `BO-02` cancellation updates `core.seat_allocations` to `status = 'cancelled'` with `cancelled_at = NOW()` (never hard-deleting) and clarify whether `core.tickets` references `(booking_id, showtime_id, seat_id)` or `seat_allocation_id`.
