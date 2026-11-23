import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import knexFactory from 'knex';
import type { Knex } from 'knex';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  dropProvisionalBo01Tables,
  dropProvisionalCa01Tables,
  ensureCoreTestSchemasAndExtensions,
  provisionProvisionalBo01Tables,
  provisionProvisionalCa01Tables,
  seedProvisionalCatalog,
} from './fixtures/ca01-bo01-provisional.js';
import type { ProvisionalCatalogSeed } from './fixtures/ca01-bo01-provisional.js';

const execFileAsync = promisify(execFile);

const testDatabaseUrl = process.env.SH01_TEST_DATABASE_URL;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const coreServiceDir = path.resolve(currentDir, '..');
const migrationsDir = path.resolve(coreServiceDir, 'db', 'migrations');

interface PgErrorShape {
  code?: string;
  constraint?: string;
  message?: string;
}

function asPgError(error: unknown): PgErrorShape {
  if (typeof error === 'object' && error !== null) {
    return error as PgErrorShape;
  }
  return {};
}

function createKnexInstance(connectionUrl: string): Knex {
  return knexFactory({
    client: 'pg',
    connection: connectionUrl,
    searchPath: ['core'],
    pool: { min: 1, max: 5 },
    migrations: {
      directory: migrationsDir,
      schemaName: 'core',
      tableName: 'knex_migrations',
      extension: 'ts',
    },
  });
}

function buildDatabaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function expectPgError(
  promise: Promise<unknown>,
  expectedCode: string,
  expectedConstraint?: string,
): Promise<PgErrorShape> {
  try {
    await promise;
  } catch (error: unknown) {
    const pgErr = asPgError(error);
    expect(pgErr.code).toBe(expectedCode);
    if (expectedConstraint !== undefined) {
      expect(pgErr.constraint).toBe(expectedConstraint);
    }
    return pgErr;
  }
  throw new Error(`Expected PostgreSQL error ${expectedCode}, but query succeeded`);
}

describe.skipIf(!testDatabaseUrl)(
  'SH-01 PostgreSQL 17 Migrations, Schema, Constraints & Concurrency',
  () => {
    const dbUrl = testDatabaseUrl ?? '';
    let knex: Knex;
    let seed: ProvisionalCatalogSeed;

    beforeAll(async () => {
      knex = createKnexInstance(dbUrl);
      await ensureCoreTestSchemasAndExtensions(knex);
    }, 30_000);

    afterAll(async () => {
      if (knex) {
        await knex.destroy();
      }
    });

    // -------------------------------------------------------------------------
    // 6a. Production Migration Blocking Check (without provisional CA-01 tables)
    // -------------------------------------------------------------------------
    it('blocks production Knex migration cleanly with 42P01 and redacted JSON logs when CA-01 is absent', async () => {
      const blockingDbName = `sh01_blocking_${randomUUID().slice(0, 8)}`;
      const adminUrl = buildDatabaseUrl(dbUrl, 'postgres');
      const blockingUrl = buildDatabaseUrl(dbUrl, blockingDbName);
      const parsedPassword = decodeURIComponent(new URL(dbUrl).password);

      const adminClient = new pg.Client({ connectionString: adminUrl });
      await adminClient.connect();
      await adminClient.query(`CREATE DATABASE "${blockingDbName}"`);

      try {
        const blockingKnex = createKnexInstance(blockingUrl);
        try {
          await ensureCoreTestSchemasAndExtensions(blockingKnex);
        } finally {
          await blockingKnex.destroy();
        }

        const runnerScript = `
          import knexFactory from 'knex';
          import baseConfig from './knexfile.ts';
          const db = knexFactory({
            ...baseConfig,
            connection: process.env.DATABASE_URL,
            searchPath: ['core'],
            migrations: { ...baseConfig.migrations, directory: './db/migrations' },
          });
          try {
            await db.migrate.latest();
            process.exit(0);
          } catch {
            process.exit(2);
          } finally {
            await db.destroy();
          }
        `;

        let exitCode = 0;
        let stdout = '';
        let stderr = '';

        try {
          const result = await execFileAsync(
            'node',
            ['--input-type=module', '-e', runnerScript],
            {
              cwd: coreServiceDir,
              env: {
                ...process.env,
                NODE_ENV: 'development',
                DATABASE_URL: blockingUrl,
                DB_SCHEMA: 'core',
                SERVICE_NAME: 'core-service',
              },
            },
          );
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (err: unknown) {
          const execErr = err as { code?: number; stdout?: string; stderr?: string };
          exitCode = execErr.code ?? 1;
          stdout = execErr.stdout ?? '';
          stderr = execErr.stderr ?? '';
        }

        expect(exitCode).toBe(2);

        const combinedLogs = `${stdout}\n${stderr}`;
        expect(combinedLogs).not.toContain(blockingUrl);
        if (parsedPassword.length > 0) {
          expect(combinedLogs).not.toContain(parsedPassword);
        }

        const jsonEntries = combinedLogs
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.startsWith('{'))
          .map((line) => JSON.parse(line) as Record<string, unknown>);

        expect(
          jsonEntries.some(
            (entry) =>
              entry.message === 'Migration started' &&
              entry.migration === '20261122083000_create_showtimes_table' &&
              entry.direction === 'up',
          ),
        ).toBe(true);

        const failedEntry = jsonEntries.find(
          (entry) =>
            entry.message === 'Migration failed' &&
            entry.migration === '20261122083000_create_showtimes_table',
        );
        expect(failedEntry).toBeDefined();
        expect(failedEntry?.errorCode).toBe('42P01');
        expect(String(failedEntry?.errorMessage ?? '')).toContain('core.movies');

        const verifyClient = new pg.Client({ connectionString: blockingUrl });
        await verifyClient.connect();
        try {
          const showtimeReg = await verifyClient.query<{ reg: string | null }>(
            "SELECT to_regclass('core.showtimes')::text AS reg",
          );
          expect(showtimeReg.rows[0]?.reg).toBeNull();
        } finally {
          await verifyClient.end();
        }
      } finally {
        await adminClient.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [blockingDbName],
        );
        await adminClient.query(`DROP DATABASE IF EXISTS "${blockingDbName}"`);
        await adminClient.end();
      }
    }, 30_000);

    // -------------------------------------------------------------------------
    // 6b. Provisional CA-01 Fixtures + Full Knex up() / down() / re-up() Cycle
    // -------------------------------------------------------------------------
    it('executes full Knex up(), reverse down() rollback, and re-up() cleanly with provisional CA-01 fixtures', async () => {
      await knex.migrate.rollback(undefined, true);
      await dropProvisionalBo01Tables(knex);
      await dropProvisionalCa01Tables(knex);

      await provisionProvisionalCa01Tables(knex);
      await knex.migrate.latest();

      const sh01TableNames = [
        'showtimes',
        'ticket_prices',
        'seat_hold_groups',
        'seat_holds',
        'seat_allocations',
      ];

      const checkSh01TablesExist = async (expectedExist: boolean): Promise<void> => {
        const res = await knex.raw<{ rows: Array<{ table_name: string }> }>(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'core'
              AND table_name = ANY(?)
          `,
          [sh01TableNames],
        );
        const found = res.rows.map((r) => r.table_name).sort();
        if (expectedExist) {
          expect(found).toEqual([...sh01TableNames].sort());
        } else {
          expect(found).toEqual([]);
        }
      };

      await checkSh01TablesExist(true);

      const appliedBeforeRollback = await knex('core.knex_migrations').select('name').orderBy('id');
      expect(appliedBeforeRollback.length).toBe(10);

      // Roll back the 5 SH-01 migrations one by one in reverse order
      for (let i = 0; i < 5; i += 1) {
        await knex.migrate.down();
      }

      await checkSh01TablesExist(false);

      const extRes = await knex.raw<{ rows: Array<{ extname: string }> }>(
        "SELECT extname FROM pg_extension WHERE extname = 'btree_gist'",
      );
      expect(extRes.rows[0]?.extname).toBe('btree_gist');

      const appliedAfterRollback = await knex('core.knex_migrations').select('name');
      expect(appliedAfterRollback.length).toBe(5);

      // Re-apply all 5 SH-01 migrations cleanly
      await knex.migrate.latest();

      await checkSh01TablesExist(true);

      const appliedAfterReUp = await knex('core.knex_migrations').select('name').orderBy('id');
      expect(appliedAfterReUp.map((row: { name: string }) => row.name)).toEqual(
        expect.arrayContaining([
          '20261122083000_create_showtimes_table.ts',
          '20261122083100_create_ticket_prices_table.ts',
          '20261122083200_create_seat_hold_groups_table.ts',
          '20261122083300_create_seat_holds_table.ts',
          '20261122083400_create_seat_allocations_table.ts',
        ]),
      );
    }, 30_000);

    // -------------------------------------------------------------------------
    // 6c. PostgreSQL Schema Inspection
    // -------------------------------------------------------------------------
    it('verifies PostgreSQL 17 columns, data types, constraints, and indexes via system catalogs', async () => {
      const colResult = await knex.raw<{
        rows: Array<{ table_name: string; column_name: string; data_type: string }>;
      }>(`
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'core'
          AND table_name IN ('showtimes', 'ticket_prices', 'seat_hold_groups', 'seat_holds', 'seat_allocations')
      `);

      const colMap = new Map<string, string>();
      for (const row of colResult.rows) {
        colMap.set(`${row.table_name}.${row.column_name}`, row.data_type);
      }

      expect(colMap.get('showtimes.id')).toBe('uuid');
      expect(colMap.get('showtimes.movie_id')).toBe('uuid');
      expect(colMap.get('showtimes.cinema_id')).toBe('uuid');
      expect(colMap.get('showtimes.auditorium_id')).toBe('uuid');
      expect(colMap.get('showtimes.starts_at')).toBe('timestamp with time zone');
      expect(colMap.get('showtimes.ends_at')).toBe('timestamp with time zone');

      expect(colMap.get('ticket_prices.id')).toBe('uuid');
      expect(colMap.get('ticket_prices.showtime_id')).toBe('uuid');
      expect(colMap.get('ticket_prices.amount_vnd')).toBe('bigint');

      expect(colMap.get('seat_hold_groups.id')).toBe('uuid');
      expect(colMap.get('seat_hold_groups.showtime_id')).toBe('uuid');
      expect(colMap.get('seat_hold_groups.expires_at')).toBe('timestamp with time zone');
      expect(colMap.get('seat_hold_groups.released_at')).toBe('timestamp with time zone');

      expect(colMap.get('seat_holds.id')).toBe('uuid');
      expect(colMap.get('seat_holds.hold_group_id')).toBe('uuid');
      expect(colMap.get('seat_holds.auditorium_id')).toBe('uuid');
      expect(colMap.get('seat_holds.seat_id')).toBe('uuid');
      expect(colMap.get('seat_holds.expires_at')).toBe('timestamp with time zone');

      expect(colMap.get('seat_allocations.id')).toBe('uuid');
      expect(colMap.get('seat_allocations.booking_id')).toBe('uuid');
      expect(colMap.get('seat_allocations.confirmed_at')).toBe('timestamp with time zone');
      expect(colMap.get('seat_allocations.cancelled_at')).toBe('timestamp with time zone');

      const constraintResult = await knex.raw<{
        rows: Array<{ conname: string; contype: string; table_name: string }>;
      }>(`
        SELECT c.conname, c.contype::text AS contype, t.relname AS table_name
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'core'
          AND t.relname IN ('showtimes', 'ticket_prices', 'seat_hold_groups', 'seat_holds', 'seat_allocations')
      `);

      const constraintMap = new Map<string, string>();
      for (const row of constraintResult.rows) {
        constraintMap.set(row.conname, row.contype);
      }

      expect(constraintMap.get('showtime_no_room_overlap')).toBe('x');
      expect(constraintMap.get('chk_showtimes_time_order')).toBe('c');
      expect(constraintMap.get('fk_showtimes_auditorium_cinema')).toBe('f');
      expect(constraintMap.get('uq_showtimes_id_auditorium')).toBe('u');
      expect(constraintMap.get('uq_ticket_prices_showtime_seat_type')).toBe('u');
      expect(constraintMap.get('chk_ticket_prices_amount_nonnegative')).toBe('c');
      expect(constraintMap.get('uq_seat_hold_groups_id_showtime')).toBe('u');
      expect(constraintMap.get('fk_seat_holds_group_showtime')).toBe('f');
      expect(constraintMap.get('fk_seat_holds_showtime_auditorium')).toBe('f');
      expect(constraintMap.get('fk_seat_holds_seat_auditorium')).toBe('f');
      expect(constraintMap.get('uq_seat_holds_group_seat')).toBe('u');
      expect(constraintMap.get('fk_seat_allocations_showtime_auditorium')).toBe('f');
      expect(constraintMap.get('fk_seat_allocations_seat_auditorium')).toBe('f');
      expect(constraintMap.get('fk_seat_allocations_hold_group_showtime')).toBe('f');
      expect(constraintMap.get('chk_seat_allocations_status_cancelled_at')).toBe('c');

      const indexResult = await knex.raw<{
        rows: Array<{ indexname: string; indexdef: string }>;
      }>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'core'
          AND tablename IN ('showtimes', 'ticket_prices', 'seat_hold_groups', 'seat_holds', 'seat_allocations')
      `);

      const indexMap = new Map<string, string>();
      for (const row of indexResult.rows) {
        indexMap.set(row.indexname, row.indexdef);
      }

      expect(indexMap.get('showtime_no_room_overlap')?.toLowerCase()).toContain('using gist');
      expect(indexMap.get('uq_hold_idempotency')?.toLowerCase()).toContain('create unique index');

      const holdActiveDef = indexMap.get('uq_seat_hold_active')?.toLowerCase() ?? '';
      expect(holdActiveDef).toContain('create unique index');
      expect(holdActiveDef).toMatch(/\(status\)::text = 'active'::text/);
      expect(holdActiveDef).not.toContain('now()');

      const allocActiveDef = indexMap.get('uq_seat_allocation_active')?.toLowerCase() ?? '';
      expect(allocActiveDef).toContain('create unique index');
      expect(allocActiveDef).toMatch(/\(status\)::text = 'active'::text/);
    });

    // -------------------------------------------------------------------------
    // Functional & Concurrency Suites (6d - 6g)
    // -------------------------------------------------------------------------
    describe('Functional & Concurrency Enforcement', () => {
      beforeAll(async () => {
        await dropProvisionalBo01Tables(knex);
        await knex.raw(
          'TRUNCATE TABLE core.seat_allocations, core.seat_holds, core.seat_hold_groups, core.ticket_prices, core.showtimes, core.seats, core.seat_pairs, core.auditoriums, core.cinemas, core.movies CASCADE',
        );
        seed = await seedProvisionalCatalog(knex);
      });

      beforeEach(async () => {
        await dropProvisionalBo01Tables(knex);
        await knex.raw(
          'TRUNCATE TABLE core.seat_allocations, core.seat_holds, core.seat_hold_groups, core.ticket_prices, core.showtimes CASCADE',
        );
      });

      // 6d. core.showtimes
      describe('core.showtimes', () => {
        it('accepts valid showtimes and rejects ends_at <= starts_at and cross-cinema auditorium mismatch', async () => {
          const [created] = await knex('core.showtimes')
            .insert({
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumAId,
              starts_at: '2026-12-01T10:00:00Z',
              ends_at: '2026-12-01T12:00:00Z',
              format: '2D',
              state: 'on_sale',
            })
            .returning('id');
          expect(created?.id).toBeDefined();

          await expectPgError(
            knex('core.showtimes').insert({
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumBId,
              starts_at: '2026-12-01T10:00:00Z',
              ends_at: '2026-12-01T10:00:00Z',
              format: '2D',
              state: 'draft',
            }),
            '23514',
            'chk_showtimes_time_order',
          );

          await expectPgError(
            knex('core.showtimes').insert({
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumBId,
              starts_at: '2026-12-01T12:00:00Z',
              ends_at: '2026-12-01T11:30:00Z',
              format: '2D',
              state: 'draft',
            }),
            '23514',
            'chk_showtimes_time_order',
          );

          await expectPgError(
            knex('core.showtimes').insert({
              movie_id: seed.movieId,
              cinema_id: seed.otherCinemaId,
              auditorium_id: seed.auditoriumAId,
              starts_at: '2026-12-01T14:00:00Z',
              ends_at: '2026-12-01T16:00:00Z',
              format: '2D',
              state: 'draft',
            }),
            '23503',
            'fk_showtimes_auditorium_cinema',
          );
        });

        it('enforces 15-minute auditorium buffer (rejects overlap & 14m gap, accepts exact 15m & different auditorium)', async () => {
          await knex('core.showtimes').insert({
            movie_id: seed.movieId,
            cinema_id: seed.cinemaId,
            auditorium_id: seed.auditoriumAId,
            starts_at: '2026-12-01T10:00:00Z',
            ends_at: '2026-12-01T12:00:00Z',
            format: '2D',
            state: 'on_sale',
          });

          // Direct overlap
          await expectPgError(
            knex('core.showtimes').insert({
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumAId,
              starts_at: '2026-12-01T11:00:00Z',
              ends_at: '2026-12-01T13:00:00Z',
              format: '3D',
              state: 'draft',
            }),
            '23P01',
            'showtime_no_room_overlap',
          );

          // 14-minute gap -> rejected
          await expectPgError(
            knex('core.showtimes').insert({
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumAId,
              starts_at: '2026-12-01T12:14:00Z',
              ends_at: '2026-12-01T14:00:00Z',
              format: '2D',
              state: 'on_sale',
            }),
            '23P01',
            'showtime_no_room_overlap',
          );

          // Exact 15-minute boundary -> accepted
          const [exact15] = await knex('core.showtimes')
            .insert({
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumAId,
              starts_at: '2026-12-01T12:15:00Z',
              ends_at: '2026-12-01T14:00:00Z',
              format: '2D',
              state: 'on_sale',
            })
            .returning('id');
          expect(exact15?.id).toBeDefined();

          // Overlapping time in different auditorium -> accepted
          const [otherRoom] = await knex('core.showtimes')
            .insert({
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumBId,
              starts_at: '2026-12-01T10:30:00Z',
              ends_at: '2026-12-01T12:30:00Z',
              format: '2D',
              state: 'on_sale',
            })
            .returning('id');
          expect(otherRoom?.id).toBeDefined();
        });

        it('prevents concurrent conflicting showtime inserts across two DB connections (1 succeeds, 1 fails 23P01 / deadlock)', async () => {
          const client1 = new pg.Client({ connectionString: dbUrl });
          const client2 = new pg.Client({ connectionString: dbUrl });
          await Promise.all([client1.connect(), client2.connect()]);

          try {
            const sql = `
              INSERT INTO core.showtimes (movie_id, cinema_id, auditorium_id, starts_at, ends_at, format, state)
              VALUES ($1, $2, $3, $4, $5, 'IMAX', 'on_sale')
              RETURNING id
            `;

            // 1. Interleaved two-connection race: TX1 holds uncommitted conflicting row,
            //    TX2 blocks on GiST exclusion check, TX1 commits -> TX2 deterministically fails with 23P01.
            await client1.query('BEGIN');
            await client1.query(sql, [
              seed.movieId,
              seed.cinemaId,
              seed.auditoriumAId,
              '2026-12-02T10:00:00Z',
              '2026-12-02T12:00:00Z',
            ]);

            const blockedInsertPromise = client2.query(sql, [
              seed.movieId,
              seed.cinemaId,
              seed.auditoriumAId,
              '2026-12-02T12:10:00Z',
              '2026-12-02T14:00:00Z',
            ]);

            await new Promise((resolve) => setTimeout(resolve, 75));
            await client1.query('COMMIT');

            const blockedErr = await expectPgError(
              blockedInsertPromise,
              '23P01',
              'showtime_no_room_overlap',
            );
            expect(blockedErr.code).toBe('23P01');

            // 2. Simultaneous Promise.allSettled race on a fresh slot:
            //    exactly 1 succeeds and 1 fails (23P01 exclusion_violation or 40P01 deadlock_detected).
            const raceResults = await Promise.allSettled([
              client1.query(sql, [
                seed.movieId,
                seed.cinemaId,
                seed.auditoriumBId,
                '2026-12-02T10:00:00Z',
                '2026-12-02T12:00:00Z',
              ]),
              client2.query(sql, [
                seed.movieId,
                seed.cinemaId,
                seed.auditoriumBId,
                '2026-12-02T12:10:00Z',
                '2026-12-02T14:00:00Z',
              ]),
            ]);

            const fulfilled = raceResults.filter((r) => r.status === 'fulfilled');
            const rejected = raceResults.filter((r) => r.status === 'rejected');

            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            const rejectionErr = asPgError(rejected[0]?.reason);
            expect(['23P01', '40P01']).toContain(rejectionErr.code);
          } finally {
            await Promise.all([client1.end(), client2.end()]);
          }
        });

        it('allows rescheduling over cancelled and completed showtimes while preserving history', async () => {
          await knex('core.showtimes').insert([
            {
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumAId,
              starts_at: '2026-12-03T10:00:00Z',
              ends_at: '2026-12-03T12:00:00Z',
              format: '2D',
              state: 'cancelled',
            },
            {
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumAId,
              starts_at: '2026-12-03T14:00:00Z',
              ends_at: '2026-12-03T16:00:00Z',
              format: '2D',
              state: 'completed',
            },
          ]);

          await knex('core.showtimes').insert([
            {
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumAId,
              starts_at: '2026-12-03T10:00:00Z',
              ends_at: '2026-12-03T12:00:00Z',
              format: '3D',
              state: 'on_sale',
            },
            {
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumAId,
              starts_at: '2026-12-03T14:00:00Z',
              ends_at: '2026-12-03T16:00:00Z',
              format: 'IMAX',
              state: 'on_sale',
            },
          ]);

          const rows = await knex('core.showtimes').select('state');
          expect(rows).toHaveLength(4);
        });
      });

      // 6e. core.ticket_prices
      describe('core.ticket_prices', () => {
        it('accepts non-negative BIGINT VND prices and rejects negative amounts and duplicate (showtime_id, seat_type)', async () => {
          const [showtime] = await knex('core.showtimes')
            .insert({
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumAId,
              starts_at: '2026-12-04T10:00:00Z',
              ends_at: '2026-12-04T12:00:00Z',
              format: '2D',
              state: 'on_sale',
            })
            .returning('id');
          const showtimeId = showtime?.id as string;

          const inserted = await knex('core.ticket_prices')
            .insert([
              { showtime_id: showtimeId, seat_type: 'standard', amount_vnd: 0 },
              { showtime_id: showtimeId, seat_type: 'vip', amount_vnd: 120000 },
              { showtime_id: showtimeId, seat_type: 'couple', amount_vnd: 150000 },
            ])
            .returning(['seat_type', 'amount_vnd']);

          expect(inserted).toHaveLength(3);
          expect(inserted.find((r) => r.seat_type === 'vip')?.amount_vnd).toBe('120000');

          await expectPgError(
            knex('core.ticket_prices').insert({
              showtime_id: showtimeId,
              seat_type: 'standard',
              amount_vnd: 95000,
            }),
            '23505',
            'uq_ticket_prices_showtime_seat_type',
          );

          await expectPgError(
            knex('core.ticket_prices').insert({
              showtime_id: showtimeId,
              seat_type: 'standard',
              amount_vnd: -1000,
            }),
            '23514',
            'chk_ticket_prices_amount_nonnegative',
          );
        });
      });

      // 6f. core.seat_hold_groups & core.seat_holds
      describe('core.seat_hold_groups & core.seat_holds', () => {
        async function createShowtimeForHold(auditoriumId: string, startsAt: string): Promise<string> {
          const [row] = await knex('core.showtimes')
            .insert({
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: auditoriumId,
              starts_at: startsAt,
              ends_at: new Date(Date.parse(startsAt) + 2 * 60 * 60 * 1000).toISOString(),
              format: '2D',
              state: 'on_sale',
            })
            .returning('id');
          return row?.id as string;
        }

        it('supports authenticated & guest hold groups, idempotency_key uniqueness, and couple seat rows', async () => {
          const showtimeId = await createShowtimeForHold(seed.auditoriumAId, '2026-12-05T10:00:00Z');
          const expiresAt = '2026-12-05T09:05:00Z';

          const [authGroup] = await knex('core.seat_hold_groups')
            .insert({
              showtime_id: showtimeId,
              owner_ref: 'user:42',
              status: 'active',
              idempotency_key: 'idem-001',
              expires_at: expiresAt,
            })
            .returning(['id', 'created_at']);

          const [guestGroup] = await knex('core.seat_hold_groups')
            .insert({
              showtime_id: showtimeId,
              owner_ref: 'guest:sha256-session-xyz',
              status: 'active',
              idempotency_key: 'idem-001',
              expires_at: expiresAt,
            })
            .returning('id');

          expect(authGroup?.id).toBeDefined();
          expect(guestGroup?.id).toBeDefined();

          // Duplicate (owner_ref, idempotency_key) rejected
          await expectPgError(
            knex('core.seat_hold_groups').insert({
              showtime_id: showtimeId,
              owner_ref: 'user:42',
              status: 'active',
              idempotency_key: 'idem-001',
              expires_at: expiresAt,
            }),
            '23505',
            'uq_hold_idempotency',
          );

          // Hold couple pair physical seats inside authGroup
          const holds = await knex('core.seat_holds')
            .insert([
              {
                hold_group_id: authGroup?.id,
                showtime_id: showtimeId,
                auditorium_id: seed.auditoriumAId,
                seat_id: seed.seatCoupleLeftId,
                status: 'active',
                expires_at: expiresAt,
              },
              {
                hold_group_id: authGroup?.id,
                showtime_id: showtimeId,
                auditorium_id: seed.auditoriumAId,
                seat_id: seed.seatCoupleRightId,
                status: 'active',
                expires_at: expiresAt,
              },
            ])
            .returning('id');
          expect(holds).toHaveLength(2);
        });

        it('rejects invalid expiration, duplicate seat in same hold group, and invalid/cross-auditorium FKs', async () => {
          const showtimeAId = await createShowtimeForHold(seed.auditoriumAId, '2026-12-06T10:00:00Z');
          const showtimeBId = await createShowtimeForHold(seed.auditoriumBId, '2026-12-06T10:00:00Z');

          // expires_at <= created_at on seat_hold_groups
          await expectPgError(
            knex('core.seat_hold_groups').insert({
              showtime_id: showtimeAId,
              owner_ref: 'user:99',
              created_at: '2026-12-06T09:00:00Z',
              expires_at: '2026-12-06T09:00:00Z',
            }),
            '23514',
            'chk_seat_hold_groups_expires_after_created',
          );

          const [groupA] = await knex('core.seat_hold_groups')
            .insert({
              showtime_id: showtimeAId,
              owner_ref: 'user:99',
              created_at: '2026-12-06T09:00:00Z',
              expires_at: '2026-12-06T09:05:00Z',
            })
            .returning('id');
          const groupAId = groupA?.id as string;

          // expires_at <= created_at on seat_holds
          await expectPgError(
            knex('core.seat_holds').insert({
              hold_group_id: groupAId,
              showtime_id: showtimeAId,
              auditorium_id: seed.auditoriumAId,
              seat_id: seed.seatA1Id,
              created_at: '2026-12-06T09:00:00Z',
              expires_at: '2026-12-06T08:59:00Z',
            }),
            '23514',
            'chk_seat_holds_expires_after_created',
          );

          // Insert valid seatA1Id
          await knex('core.seat_holds').insert({
            hold_group_id: groupAId,
            showtime_id: showtimeAId,
            auditorium_id: seed.auditoriumAId,
            seat_id: seed.seatA1Id,
            expires_at: '2026-12-06T09:05:00Z',
          });

          // Duplicate seat_id inside same hold_group_id
          await expectPgError(
            knex('core.seat_holds').insert({
              hold_group_id: groupAId,
              showtime_id: showtimeAId,
              auditorium_id: seed.auditoriumAId,
              seat_id: seed.seatA1Id,
              status: 'released',
              expires_at: '2026-12-06T09:05:00Z',
            }),
            '23505',
            'uq_seat_holds_group_seat',
          );

          // Missing showtime_id FK on seat_hold_groups
          await expectPgError(
            knex('core.seat_hold_groups').insert({
              showtime_id: randomUUID(),
              owner_ref: 'user:99',
              created_at: '2026-12-06T09:00:00Z',
              expires_at: '2026-12-06T09:05:00Z',
            }),
            '23503',
            'fk_seat_hold_groups_showtime',
          );

          // Missing seat_id FK
          await expectPgError(
            knex('core.seat_holds').insert({
              hold_group_id: groupAId,
              showtime_id: showtimeAId,
              auditorium_id: seed.auditoriumAId,
              seat_id: randomUUID(),
              expires_at: '2026-12-06T09:05:00Z',
            }),
            '23503',
            'fk_seat_holds_seat_auditorium',
          );

          // Seat belonging to auditoriumB inserted for showtimeA (auditoriumA) -> rejected
          await expectPgError(
            knex('core.seat_holds').insert({
              hold_group_id: groupAId,
              showtime_id: showtimeAId,
              auditorium_id: seed.auditoriumAId,
              seat_id: seed.seatB1Id,
              expires_at: '2026-12-06T09:05:00Z',
            }),
            '23503',
            'fk_seat_holds_seat_auditorium',
          );

          // Passing auditoriumB for showtimeA -> rejected by showtime_auditorium FK
          await expectPgError(
            knex('core.seat_holds').insert({
              hold_group_id: groupAId,
              showtime_id: showtimeAId,
              auditorium_id: seed.auditoriumBId,
              seat_id: seed.seatB1Id,
              expires_at: '2026-12-06T09:05:00Z',
            }),
            '23503',
            'fk_seat_holds_showtime_auditorium',
          );

          // Hold group belonging to showtimeA used with showtimeB -> rejected
          await expectPgError(
            knex('core.seat_holds').insert({
              hold_group_id: groupAId,
              showtime_id: showtimeBId,
              auditorium_id: seed.auditoriumBId,
              seat_id: seed.seatB1Id,
              expires_at: '2026-12-06T09:05:00Z',
            }),
            '23503',
            'fk_seat_holds_group_showtime',
          );
        });

        it('prevents concurrent active hold inserts for the same (showtime_id, seat_id) across two connections (23505)', async () => {
          const showtimeId = await createShowtimeForHold(seed.auditoriumAId, '2026-12-07T10:00:00Z');
          const [g1] = await knex('core.seat_hold_groups')
            .insert({
              showtime_id: showtimeId,
              owner_ref: 'user:101',
              expires_at: '2026-12-07T09:05:00Z',
            })
            .returning('id');
          const [g2] = await knex('core.seat_hold_groups')
            .insert({
              showtime_id: showtimeId,
              owner_ref: 'user:102',
              expires_at: '2026-12-07T09:05:00Z',
            })
            .returning('id');

          const client1 = new pg.Client({ connectionString: dbUrl });
          const client2 = new pg.Client({ connectionString: dbUrl });
          await Promise.all([client1.connect(), client2.connect()]);

          try {
            const sql = `
              INSERT INTO core.seat_holds (hold_group_id, showtime_id, auditorium_id, seat_id, status, expires_at)
              VALUES ($1, $2, $3, $4, 'active', '2026-12-07T09:05:00Z')
              RETURNING id
            `;

            const results = await Promise.allSettled([
              client1.query(sql, [g1?.id, showtimeId, seed.auditoriumAId, seed.seatA1Id]),
              client2.query(sql, [g2?.id, showtimeId, seed.auditoriumAId, seed.seatA1Id]),
            ]);

            const fulfilled = results.filter((r) => r.status === 'fulfilled');
            const rejected = results.filter((r) => r.status === 'rejected');

            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            const rejectionErr = asPgError(rejected[0]?.reason);
            expect(rejectionErr.code).toBe('23505');
            expect(rejectionErr.constraint).toBe('uq_seat_hold_active');

            // Releasing the active hold frees (showtime_id, seat_id) for a new active hold
            await knex('core.seat_holds')
              .where({ showtime_id: showtimeId, seat_id: seed.seatA1Id, status: 'active' })
              .update({ status: 'released' });

            const [g3] = await knex('core.seat_hold_groups')
              .insert({
                showtime_id: showtimeId,
                owner_ref: 'user:103',
                expires_at: '2026-12-07T09:05:00Z',
              })
              .returning('id');

            const [reheld] = await knex('core.seat_holds')
              .insert({
                hold_group_id: g3?.id,
                showtime_id: showtimeId,
                auditorium_id: seed.auditoriumAId,
                seat_id: seed.seatA1Id,
                status: 'active',
                expires_at: '2026-12-07T09:05:00Z',
              })
              .returning('id');
            expect(reheld?.id).toBeDefined();
          } finally {
            await Promise.all([client1.end(), client2.end()]);
          }
        });
      });

      // 6g. core.seat_allocations
      describe('core.seat_allocations', () => {
        async function createShowtimeForAllocation(): Promise<{
          showtimeId: string;
          holdGroupId: string;
        }> {
          const [showtime] = await knex('core.showtimes')
            .insert({
              movie_id: seed.movieId,
              cinema_id: seed.cinemaId,
              auditorium_id: seed.auditoriumAId,
              starts_at: '2026-12-08T10:00:00Z',
              ends_at: '2026-12-08T12:00:00Z',
              format: '2D',
              state: 'on_sale',
            })
            .returning('id');
          const showtimeId = showtime?.id as string;

          const [group] = await knex('core.seat_hold_groups')
            .insert({
              showtime_id: showtimeId,
              owner_ref: 'user:200',
              status: 'confirmed',
              expires_at: '2026-12-08T09:05:00Z',
            })
            .returning('id');
          return { showtimeId, holdGroupId: group?.id as string };
        }

        it('rejects duplicate active allocation, wrong-auditorium seat, and allows reallocation after soft cancellation', async () => {
          const { showtimeId, holdGroupId } = await createShowtimeForAllocation();
          const booking1 = randomUUID();
          const booking2 = randomUUID();

          const [alloc1] = await knex('core.seat_allocations')
            .insert({
              showtime_id: showtimeId,
              auditorium_id: seed.auditoriumAId,
              seat_id: seed.seatA1Id,
              booking_id: booking1,
              hold_group_id: holdGroupId,
              status: 'active',
            })
            .returning('id');
          const alloc1Id = alloc1?.id as string;
          expect(alloc1Id).toBeDefined();

          // Duplicate active allocation rejected
          await expectPgError(
            knex('core.seat_allocations').insert({
              showtime_id: showtimeId,
              auditorium_id: seed.auditoriumAId,
              seat_id: seed.seatA1Id,
              booking_id: booking2,
              status: 'active',
            }),
            '23505',
            'uq_seat_allocation_active',
          );

          // Seat from wrong auditorium rejected
          await expectPgError(
            knex('core.seat_allocations').insert({
              showtime_id: showtimeId,
              auditorium_id: seed.auditoriumAId,
              seat_id: seed.seatB1Id,
              booking_id: booking2,
              status: 'active',
            }),
            '23503',
            'fk_seat_allocations_seat_auditorium',
          );

          // Invalid soft-cancellation without cancelled_at rejected
          await expectPgError(
            knex('core.seat_allocations')
              .where({ id: alloc1Id })
              .update({ status: 'cancelled', cancelled_at: null }),
            '23514',
            'chk_seat_allocations_status_cancelled_at',
          );

          // Proper soft cancellation preserves row and allows new active allocation
          await knex('core.seat_allocations')
            .where({ id: alloc1Id })
            .update({ status: 'cancelled', cancelled_at: knex.fn.now() });

          const [alloc2] = await knex('core.seat_allocations')
            .insert({
              showtime_id: showtimeId,
              auditorium_id: seed.auditoriumAId,
              seat_id: seed.seatA1Id,
              booking_id: booking2,
              hold_group_id: null,
              status: 'active',
            })
            .returning('id');
          expect(alloc2?.id).toBeDefined();

          const allRows = await knex('core.seat_allocations')
            .where({ showtime_id: showtimeId, seat_id: seed.seatA1Id })
            .select('status', 'booking_id');
          expect(allRows).toHaveLength(2);
          expect(allRows.map((r) => r.status).sort()).toEqual(['active', 'cancelled']);
        });

        it('prevents concurrent duplicate active allocations across two connections (1 succeeds, 1 fails 23505)', async () => {
          const { showtimeId } = await createShowtimeForAllocation();
          const client1 = new pg.Client({ connectionString: dbUrl });
          const client2 = new pg.Client({ connectionString: dbUrl });
          await Promise.all([client1.connect(), client2.connect()]);

          try {
            const sql = `
              INSERT INTO core.seat_allocations (showtime_id, auditorium_id, seat_id, booking_id, status)
              VALUES ($1, $2, $3, $4, 'active')
              RETURNING id
            `;

            const results = await Promise.allSettled([
              client1.query(sql, [showtimeId, seed.auditoriumAId, seed.seatA2Id, randomUUID()]),
              client2.query(sql, [showtimeId, seed.auditoriumAId, seed.seatA2Id, randomUUID()]),
            ]);

            const fulfilled = results.filter((r) => r.status === 'fulfilled');
            const rejected = results.filter((r) => r.status === 'rejected');

            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            const rejectionErr = asPgError(rejected[0]?.reason);
            expect(rejectionErr.code).toBe('23505');
            expect(rejectionErr.constraint).toBe('uq_seat_allocation_active');
          } finally {
            await Promise.all([client1.end(), client2.end()]);
          }
        });

        it('validates the deferred BO-01 fk_seat_allocations_booking contract using provisional core.bookings', async () => {
          const { showtimeId, holdGroupId } = await createShowtimeForAllocation();
          await provisionProvisionalBo01Tables(knex);

          try {
            const validBookingId = randomUUID();
            await knex('core.bookings').insert({
              id: validBookingId,
              hold_group_id: holdGroupId,
              status: 'confirmed',
            });

            const [allocated] = await knex('core.seat_allocations')
              .insert({
                showtime_id: showtimeId,
                auditorium_id: seed.auditoriumAId,
                seat_id: seed.seatA1Id,
                booking_id: validBookingId,
                hold_group_id: holdGroupId,
                status: 'active',
              })
              .returning('id');
            expect(allocated?.id).toBeDefined();

            await expectPgError(
              knex('core.seat_allocations').insert({
                showtime_id: showtimeId,
                auditorium_id: seed.auditoriumAId,
                seat_id: seed.seatA2Id,
                booking_id: randomUUID(),
                status: 'active',
              }),
              '23503',
              'fk_seat_allocations_booking',
            );
          } finally {
            await knex.raw('TRUNCATE TABLE core.seat_allocations, core.bookings CASCADE');
            await dropProvisionalBo01Tables(knex);
          }
        });
      });
    });
  },
);
