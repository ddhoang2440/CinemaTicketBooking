import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import knexFactory from 'knex';
import type { Knex } from 'knex';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runLoggedMigration } from '../db/utils/migration-logger.js';
import { logger } from '../src/common/utils/logger.js';
import {
  createProvisionalBooking,
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

const SH01_MIGRATIONS = [
  '20261122161000_create_showtimes_table.ts',
  '20261122161100_create_ticket_prices_table.ts',
  '20261122161200_create_seat_hold_groups_table.ts',
  '20261122161300_create_seat_holds_table.ts',
  '20261122161400_create_seat_allocations_table.ts',
] as const;

// Relative UTC date anchor: always at least 2 days ahead of current UTC midnight
// so showtime schedules and DB-default created_at hold expirations never drift into the past.
const BASE_UTC_MIDNIGHT_MS =
  Math.floor(Date.now() / 86_400_000) * 86_400_000 + 2 * 86_400_000;

function utcAt(dayOffset: number, hour: number, minute = 0, second = 0): string {
  const ms =
    BASE_UTC_MIDNIGHT_MS +
    dayOffset * 86_400_000 +
    hour * 3_600_000 +
    minute * 60_000 +
    second * 1_000;
  return new Date(ms).toISOString();
}

function futureIsoFromNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function shiftIso(iso: string, deltaMs: number): string {
  return new Date(Date.parse(iso) + deltaMs).toISOString();
}

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

function buildDatabaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function createDirectoryKnexInstance(connectionUrl: string): Knex {
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
      loadExtensions: ['.ts'],
    },
  });
}

function createSh01OnlyMigrationSource(files: readonly string[]): Knex.MigrationSource<string> {
  return {
    getMigrations: async () => [...files],
    getMigrationName: (migration: string) => migration,
    getMigration: async (migration: string) => {
      const moduleUrl = pathToFileURL(path.join(migrationsDir, migration)).href;
      return (await import(moduleUrl)) as Knex.Migration;
    },
  };
}

function createSh01IsolatedKnexInstance(connectionUrl: string): Knex {
  return knexFactory({
    client: 'pg',
    connection: connectionUrl,
    searchPath: ['core'],
    pool: { min: 1, max: 5 },
    migrations: {
      migrationSource: createSh01OnlyMigrationSource(SH01_MIGRATIONS),
      schemaName: 'core',
      tableName: 'knex_migrations',
    },
  });
}

async function createIsolatedDatabase(adminUrl: string, prefix: string): Promise<{
  dbName: string;
  dbUrl: string;
}> {
  const dbName = `${prefix}_${randomUUID().slice(0, 8)}`;
  const adminClient = new pg.Client({ connectionString: adminUrl });
  await adminClient.connect();
  try {
    await adminClient.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
  } finally {
    await adminClient.end();
  }
  return {
    dbName,
    dbUrl: buildDatabaseUrl(adminUrl, dbName),
  };
}

async function dropIsolatedDatabase(adminUrl: string, dbName: string): Promise<void> {
  const adminClient = new pg.Client({ connectionString: adminUrl });
  await adminClient.connect();
  try {
    await adminClient.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await adminClient.end();
  }
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

describe('SH-01 Migration File Ordering (Static Repository Verification)', () => {
  it('orders migrations strictly as ID-01 -> CA-01 -> SH-01 -> BO-01 with zero legacy 20261122083* files', () => {
    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.ts'))
      .sort();

    expect(files.some((file) => file.startsWith('20261122083'))).toBe(false);

    const id01 = files.filter((file) => file.startsWith('20261119'));
    const ca01 = files.filter((file) => file.startsWith('20261122160'));
    const sh01 = files.filter((file) => file.startsWith('20261122161'));
    const bo01 = files.filter(
      (file) => file.startsWith('20261122170') || file.startsWith('20261123100000'),
    );

    expect(id01).toHaveLength(5);
    expect(ca01).toHaveLength(6);
    expect(sh01).toEqual([...SH01_MIGRATIONS]);
    expect(bo01).toHaveLength(7);
    expect(files).toEqual([...id01, ...ca01, ...sh01, ...bo01]);
  });
});

describe('SH-01 Migration Logger Credential Redaction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function captureSanitizedErrorMessage(rawErrorMessage: string): Promise<string> {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

    await expect(
      runLoggedMigration('test_redaction_migration', 'up', async () => {
        const err = new Error(rawErrorMessage) as Error & { code?: string };
        err.code = '28P01';
        throw err;
      }),
    ).rejects.toThrow();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    const loggedContext = errorSpy.mock.calls[0]?.[1] as { errorMessage?: unknown } | undefined;
    expect(typeof loggedContext?.errorMessage).toBe('string');
    return String(loggedContext?.errorMessage ?? '');
  }

  it('redacts quoted libpq values, Bearer tokens, JSON secrets, short pwd/pass keys, and unencoded-quote/space DSNs without over-greedy matching', async () => {
    const cases: ReadonlyArray<{
      label: string;
      input: string;
      forbidden: readonly string[];
      expectedContains?: readonly string[];
    }> = [
      {
        label: 'single-quoted libpq password',
        input:
          "FATAL: host=localhost user=admin password='quoted_secret_pw' passwd='my\\'escaped_sq' dbname=cinema",
        forbidden: ['quoted_secret_pw', "my\\'escaped_sq", 'escaped_sq'],
        expectedContains: ['password=[REDACTED]', 'passwd=[REDACTED]', 'dbname=cinema'],
      },
      {
        label: 'double-quoted libpq password',
        input:
          'FATAL: host=localhost user=admin password="double_quoted_pw" secret="my\\"escaped_dq" dbname=cinema',
        forbidden: ['double_quoted_pw', 'my\\"escaped_dq', 'escaped_dq'],
        expectedContains: ['password=[REDACTED]', 'secret=[REDACTED]', 'dbname=cinema'],
      },
      {
        label: 'authorization=Bearer and authorization: Bearer tokens',
        input:
          'auth failed: authorization=Bearer header_secret_jwt_123 Authorization: Bearer colon_secret_jwt_456 next=ok',
        forbidden: ['header_secret_jwt_123', 'colon_secret_jwt_456'],
        expectedContains: ['authorization=[REDACTED]', 'Authorization:[REDACTED]', 'next=ok'],
      },
      {
        label: 'JSON colon secrets with optional whitespace',
        input:
          '{"error":"auth","password":"json_secret_pw","token":"json_tok_1","secret" : "json_sec_2","passwd":"json_pw_3","authorization" : "Bearer json_jwt_4"}',
        forbidden: [
          'json_secret_pw',
          'json_tok_1',
          'json_sec_2',
          'json_pw_3',
          'json_jwt_4',
        ],
        expectedContains: ['"error":"auth"', '[REDACTED]'],
      },
      {
        label: 'short keys pwd and pass across unquoted, quoted, and JSON forms',
        input:
          'pwd=short_pwd_val pass=short_pass_val PWD=\'quoted_pwd_val\' PASS="quoted_pass_val" {"pwd":"json_pwd_val","pass":"json_pass_val"}',
        forbidden: [
          'short_pwd_val',
          'short_pass_val',
          'quoted_pwd_val',
          'quoted_pass_val',
          'json_pwd_val',
          'json_pass_val',
        ],
        expectedContains: ['pwd=[REDACTED]', 'pass=[REDACTED]', 'PWD=[REDACTED]', 'PASS=[REDACTED]'],
      },
      {
        label: 'DSN with unencoded single quote in password',
        input: "connect failed for postgres://admin:my'secretPW@db.host:5432/cinema",
        forbidden: ["my'secretPW", 'secretPW'],
        expectedContains: ['connect failed for [REDACTED_CONNECTION_URI]'],
      },
      {
        label: 'DSN with space in password',
        input: 'connect failed for postgresql://admin:my spacePW@db.host:5432/cinema',
        forbidden: ['my spacePW', 'spacePW'],
        expectedContains: ['connect failed for [REDACTED_CONNECTION_URI]'],
      },
      {
        label: 'standard URIs, @ in password, query params, and unquoted key=value / PGPASSWORD',
        input:
          'postgres://cinema_user:p@ssw0rd@db.internal:5432/cinema?sslmode=require&password=qs_secret_99&token=qs_tok_77 password=libpq_secret_pw PGPASSWORD=pg_env_secret_pw token=tok_abc secret=sec_xyz',
        forbidden: [
          'p@ssw0rd',
          'qs_secret_99',
          'qs_tok_77',
          'libpq_secret_pw',
          'pg_env_secret_pw',
          'tok_abc',
          'sec_xyz',
        ],
        expectedContains: [
          '[REDACTED_CONNECTION_URI]',
          'password=[REDACTED]',
          'PGPASSWORD=[REDACTED]',
          'token=[REDACTED]',
          'secret=[REDACTED]',
        ],
      },
      {
        label: 'multiple URIs and unrelated email preserved without over-greedy match',
        input:
          'primary=postgres://admin:pw_one@db1.host:5432/cinema; contact ops@example.com; secondary=postgresql://admin:pw_two@db2.host:5432/cinema',
        forbidden: ['pw_one', 'pw_two'],
        expectedContains: [
          'primary=[REDACTED_CONNECTION_URI]',
          'contact ops@example.com;',
          'secondary=[REDACTED_CONNECTION_URI]',
        ],
      },
    ];

    for (const testCase of cases) {
      const sanitized = await captureSanitizedErrorMessage(testCase.input);
      for (const secret of testCase.forbidden) {
        expect(sanitized, `${testCase.label} leaked ${secret}`).not.toContain(secret);
      }
      for (const expectedFragment of testCase.expectedContains ?? []) {
        expect(sanitized, `${testCase.label} missing ${expectedFragment}`).toContain(
          expectedFragment,
        );
      }
    }
  });
});

describe.skipIf(!testDatabaseUrl)(
  'SH-01 PostgreSQL 17 Real-Schema, Logger & Isolated Contract Integration',
  () => {
    const baseDbUrl = testDatabaseUrl ?? '';

    // -------------------------------------------------------------------------
    // Suite 1: Real Merged-Schema Migration & BO-01 Compatibility (NO stubs)
    // -------------------------------------------------------------------------
    describe('1. Real Merged-Schema Migration Verification (ID-01 -> CA-01 -> SH-01 -> BO-01)', () => {
      let mergedDbName = '';
      let mergedKnex: Knex | undefined;

      afterAll(async () => {
        if (mergedKnex) {
          await mergedKnex.destroy();
        }
        if (mergedDbName) {
          await dropIsolatedDatabase(baseDbUrl, mergedDbName);
        }
      }, 30_000);

      it('runs real db/migrations/ cleanly without provisional stubs and verifies order, rollback/reapply, and BO-01 FK compatibility', async () => {
        const created = await createIsolatedDatabase(baseDbUrl, 'sh01_merged');
        mergedDbName = created.dbName;
        mergedKnex = createDirectoryKnexInstance(created.dbUrl);
        await ensureCoreTestSchemasAndExtensions(mergedKnex);

        // Run real migrations with ZERO provisional CA-01 or BO-01 stubs.
        // If TV2 CA-01 still omits uq_auditoriums_id_cinema / uq_seats_id_auditorium,
        // PostgreSQL raises SQLSTATE 42830 and this test must surface that blocker honestly.
        try {
          await mergedKnex.migrate.latest();
        } catch (error: unknown) {
          const pgErr = asPgError(error);
          if (pgErr.code === '42830') {
            throw new Error(
              `EXTERNAL TV2 CA-01 BLOCKER (SQLSTATE 42830): Real CA-01 migrations (20261122160200_create_auditoriums_table.ts / 20261122160400_create_seats_table.ts) are missing UNIQUE (id, cinema_id) and/or UNIQUE (id, auditorium_id) required by SH-01 composite FKs. Original error: ${pgErr.message ?? 'unknown'}`,
            );
          }
          throw error;
        }

        const applied = await mergedKnex('core.knex_migrations')
          .select<{ name: string }[]>('name')
          .orderBy('id', 'asc');
        const names = applied.map((row) => row.name);
        expect(names).toHaveLength(23);

        const lastCa01Idx = names.findIndex((n) => n.startsWith('20261122160500'));
        const firstSh01Idx = names.findIndex((n) => n.startsWith('20261122161000'));
        const lastSh01Idx = names.findIndex((n) => n.startsWith('20261122161400'));
        const firstBo01Idx = names.findIndex((n) => n.startsWith('20261122170000'));
        expect(lastCa01Idx).toBeGreaterThanOrEqual(0);
        expect(firstSh01Idx).toBe(lastCa01Idx + 1);
        expect(lastSh01Idx).toBe(firstSh01Idx + 4);
        expect(firstBo01Idx).toBe(lastSh01Idx + 1);

        // Verify real BO-01 fk_seat_allocations_booking compatibility with real core.bookings
        const [movie] = await mergedKnex('core.movies')
          .insert({ title: 'Merged Schema Movie', duration_min: 120, status: 'active' })
          .returning('id');
        const [cinema] = await mergedKnex('core.cinemas')
          .insert({ name: 'Merged Cinema', address: '1 Main St', city: 'HCM', status: 'active' })
          .returning('id');
        const [auditorium] = await mergedKnex('core.auditoriums')
          .insert({ cinema_id: cinema?.id, name: 'Hall 1', supported_formats: ['2D'], status: 'active' })
          .returning('id');
        const [seat] = await mergedKnex('core.seats')
          .insert({
            auditorium_id: auditorium?.id,
            row_label: 'A',
            seat_number: 1,
            seat_type: 'standard',
            couple_pair_id: null,
          })
          .returning('id');
        const [showtime] = await mergedKnex('core.showtimes')
          .insert({
            movie_id: movie?.id,
            cinema_id: cinema?.id,
            auditorium_id: auditorium?.id,
            starts_at: utcAt(1, 10, 0),
            ends_at: utcAt(1, 12, 0),
            format: '2D',
            state: 'on_sale',
          })
          .returning('id');
        const [holdGroup] = await mergedKnex('core.seat_hold_groups')
          .insert({
            showtime_id: showtime?.id,
            owner_ref: 'guest:merged-check',
            status: 'confirmed',
            expires_at: futureIsoFromNow(300_000),
          })
          .returning('id');
        const [booking] = await mergedKnex('core.bookings')
          .insert({
            booking_code: 'MRG001',
            contact_name: 'Merged User',
            contact_email: 'merged@example.test',
            guest_token_hash: 'hash-merged-check',
            hold_group_id: holdGroup?.id,
            idempotency_key: 'idem-merged-001',
            status: 'confirmed',
            total_vnd: 90000,
            expires_at: futureIsoFromNow(900_000),
            confirmed_at: new Date().toISOString(),
          })
          .returning('id');

        const [allocation] = await mergedKnex('core.seat_allocations')
          .insert({
            showtime_id: showtime?.id,
            auditorium_id: auditorium?.id,
            seat_id: seat?.id,
            booking_id: booking?.id,
            hold_group_id: holdGroup?.id,
            status: 'active',
          })
          .returning('id');
        expect(allocation?.id).toBeDefined();

        // Roll back BO-01 (7) + SH-01 (5) cleanly and re-apply
        for (let i = 0; i < 12; i += 1) {
          await mergedKnex.migrate.down();
        }
        const remainingAfterDown = await mergedKnex('core.knex_migrations').select('name');
        expect(remainingAfterDown).toHaveLength(11);

        await mergedKnex.migrate.latest();
        const reapplied = await mergedKnex('core.knex_migrations').select('name');
        expect(reapplied).toHaveLength(23);
      }, 60_000);
    });

    // -------------------------------------------------------------------------
    // Suite 2: Migration Logger Isolation Test (42P01 + Credential Redaction)
    // -------------------------------------------------------------------------
    describe('2. Migration Logger Isolation (runLoggedMigration 42P01 & Redaction)', () => {
      it('logs structured JSON failure with 42P01 and redacts DATABASE_URL/password when upstream parent table is absent', async () => {
        const { dbName, dbUrl: isolatedLoggerUrl } = await createIsolatedDatabase(
          baseDbUrl,
          'sh01_logger',
        );
        const parsedPassword = decodeURIComponent(new URL(baseDbUrl).password);
        const showtimeMigrationUrl = pathToFileURL(
          path.join(migrationsDir, '20261122161000_create_showtimes_table.ts'),
        ).href;

        try {
          const setupKnex = createSh01IsolatedKnexInstance(isolatedLoggerUrl);
          try {
            await ensureCoreTestSchemasAndExtensions(setupKnex);
          } finally {
            await setupKnex.destroy();
          }

          const runnerScript = `
            import knexFactory from 'knex';
            import * as showtimeMigration from ${JSON.stringify(showtimeMigrationUrl)};
            const db = knexFactory({
              client: 'pg',
              connection: process.env.DATABASE_URL,
              searchPath: ['core'],
              migrations: {
                schemaName: 'core',
                tableName: 'knex_migrations',
                migrationSource: {
                  getMigrations: async () => ['20261122161000_create_showtimes_table.ts'],
                  getMigrationName: (m) => m,
                  getMigration: async () => showtimeMigration,
                },
              },
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
                  DATABASE_URL: isolatedLoggerUrl,
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
          expect(combinedLogs).not.toContain(isolatedLoggerUrl);
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
                entry.migration === '20261122161000_create_showtimes_table' &&
                entry.direction === 'up',
            ),
          ).toBe(true);

          const failedEntry = jsonEntries.find(
            (entry) =>
              entry.message === 'Migration failed' &&
              entry.migration === '20261122161000_create_showtimes_table',
          );
          expect(failedEntry).toBeDefined();
          expect(failedEntry?.errorCode).toBe('42P01');
          expect(String(failedEntry?.errorMessage ?? '')).toContain('core.movies');

          const verifyClient = new pg.Client({ connectionString: isolatedLoggerUrl });
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
          await dropIsolatedDatabase(baseDbUrl, dbName);
        }
      }, 30_000);
    });

    // -------------------------------------------------------------------------
    // Suite 3: Isolated SH-01 Contract, Constraint & Concurrency Suite
    // (Uses contract-aligned provisional CA-01/BO-01 fixtures in an isolated DB
    //  pending TV2 adding uq_auditoriums_id_cinema & uq_seats_id_auditorium)
    // -------------------------------------------------------------------------
    describe('3. Isolated SH-01 Contract, Constraint & Concurrency Suite (Provisional CA-01/BO-01)', () => {
      let contractDbName = '';
      let contractDbUrl = '';
      let knex: Knex;
      let seed: ProvisionalCatalogSeed;

      beforeAll(async () => {
        const created = await createIsolatedDatabase(baseDbUrl, 'sh01_contract');
        contractDbName = created.dbName;
        contractDbUrl = created.dbUrl;
        knex = createSh01IsolatedKnexInstance(contractDbUrl);
        await ensureCoreTestSchemasAndExtensions(knex);
      }, 30_000);

      afterAll(async () => {
        if (knex) {
          await knex.destroy();
        }
        if (contractDbName) {
          await dropIsolatedDatabase(baseDbUrl, contractDbName);
        }
      }, 30_000);

      it('executes SH-01 up(), 5x reverse down() rollback, and re-up() cleanly against contract CA-01 fixtures', async () => {
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
        expect(appliedBeforeRollback).toHaveLength(SH01_MIGRATIONS.length);
        expect(appliedBeforeRollback.map((row: { name: string }) => row.name)).toEqual([
          ...SH01_MIGRATIONS,
        ]);

        // Roll back the 5 SH-01 migrations one by one in reverse order
        for (let i = 0; i < SH01_MIGRATIONS.length; i += 1) {
          await knex.migrate.down();
        }

        await checkSh01TablesExist(false);

        const extRes = await knex.raw<{ rows: Array<{ extname: string }> }>(
          "SELECT extname FROM pg_extension WHERE extname = 'btree_gist'",
        );
        expect(extRes.rows[0]?.extname).toBe('btree_gist');

        const appliedAfterRollback = await knex('core.knex_migrations').select('name');
        expect(appliedAfterRollback).toHaveLength(0);

        // Re-apply all 5 SH-01 migrations cleanly
        await knex.migrate.latest();
        await checkSh01TablesExist(true);

        const appliedAfterReUp = await knex('core.knex_migrations').select('name').orderBy('id');
        expect(appliedAfterReUp.map((row: { name: string }) => row.name)).toEqual([
          ...SH01_MIGRATIONS,
        ]);
      }, 30_000);

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
        expect(constraintMap.get('chk_seat_hold_groups_status_released_at')).toBe('c');
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

        describe('core.showtimes', () => {
          it('accepts valid showtimes and rejects ends_at <= starts_at and cross-cinema auditorium mismatch', async () => {
            const [created] = await knex('core.showtimes')
              .insert({
                movie_id: seed.movieId,
                cinema_id: seed.cinemaId,
                auditorium_id: seed.auditoriumAId,
                starts_at: utcAt(0, 10, 0),
                ends_at: utcAt(0, 12, 0),
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
                starts_at: utcAt(0, 10, 0),
                ends_at: utcAt(0, 10, 0),
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
                starts_at: utcAt(0, 12, 0),
                ends_at: utcAt(0, 11, 30),
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
                starts_at: utcAt(0, 14, 0),
                ends_at: utcAt(0, 16, 0),
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
              starts_at: utcAt(0, 10, 0),
              ends_at: utcAt(0, 12, 0),
              format: '2D',
              state: 'on_sale',
            });

            // Direct overlap
            await expectPgError(
              knex('core.showtimes').insert({
                movie_id: seed.movieId,
                cinema_id: seed.cinemaId,
                auditorium_id: seed.auditoriumAId,
                starts_at: utcAt(0, 11, 0),
                ends_at: utcAt(0, 13, 0),
                format: '3D',
                state: 'draft',
              }),
              '23P01',
              'showtime_no_room_overlap',
            );

            // 14m59s gap -> rejected
            await expectPgError(
              knex('core.showtimes').insert({
                movie_id: seed.movieId,
                cinema_id: seed.cinemaId,
                auditorium_id: seed.auditoriumAId,
                starts_at: utcAt(0, 12, 14, 59),
                ends_at: utcAt(0, 14, 0),
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
                starts_at: utcAt(0, 12, 15, 0),
                ends_at: utcAt(0, 14, 0),
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
                starts_at: utcAt(0, 10, 30),
                ends_at: utcAt(0, 12, 30),
                format: '2D',
                state: 'on_sale',
              })
              .returning('id');
            expect(otherRoom?.id).toBeDefined();
          });

          it('prevents concurrent conflicting showtime inserts across two DB connections (1 succeeds, 1 fails 23P01 / deadlock)', async () => {
            const client1 = new pg.Client({ connectionString: contractDbUrl });
            const client2 = new pg.Client({ connectionString: contractDbUrl });
            await Promise.all([client1.connect(), client2.connect()]);

            try {
              const sql = `
                INSERT INTO core.showtimes (movie_id, cinema_id, auditorium_id, starts_at, ends_at, format, state)
                VALUES ($1, $2, $3, $4, $5, 'IMAX', 'on_sale')
                RETURNING id
              `;

              await client1.query('BEGIN');
              await client1.query(sql, [
                seed.movieId,
                seed.cinemaId,
                seed.auditoriumAId,
                utcAt(1, 10, 0),
                utcAt(1, 12, 0),
              ]);

              const blockedInsertPromise = client2.query(sql, [
                seed.movieId,
                seed.cinemaId,
                seed.auditoriumAId,
                utcAt(1, 12, 10),
                utcAt(1, 14, 0),
              ]);

              await new Promise((resolve) => setTimeout(resolve, 75));
              await client1.query('COMMIT');

              const blockedErr = await expectPgError(
                blockedInsertPromise,
                '23P01',
                'showtime_no_room_overlap',
              );
              expect(blockedErr.code).toBe('23P01');

              const raceResults = await Promise.allSettled([
                client1.query(sql, [
                  seed.movieId,
                  seed.cinemaId,
                  seed.auditoriumBId,
                  utcAt(1, 10, 0),
                  utcAt(1, 12, 0),
                ]),
                client2.query(sql, [
                  seed.movieId,
                  seed.cinemaId,
                  seed.auditoriumBId,
                  utcAt(1, 12, 10),
                  utcAt(1, 14, 0),
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
                starts_at: utcAt(2, 10, 0),
                ends_at: utcAt(2, 12, 0),
                format: '2D',
                state: 'cancelled',
              },
              {
                movie_id: seed.movieId,
                cinema_id: seed.cinemaId,
                auditorium_id: seed.auditoriumAId,
                starts_at: utcAt(2, 14, 0),
                ends_at: utcAt(2, 16, 0),
                format: '2D',
                state: 'completed',
              },
            ]);

            await knex('core.showtimes').insert([
              {
                movie_id: seed.movieId,
                cinema_id: seed.cinemaId,
                auditorium_id: seed.auditoriumAId,
                starts_at: utcAt(2, 10, 0),
                ends_at: utcAt(2, 12, 0),
                format: '3D',
                state: 'on_sale',
              },
              {
                movie_id: seed.movieId,
                cinema_id: seed.cinemaId,
                auditorium_id: seed.auditoriumAId,
                starts_at: utcAt(2, 14, 0),
                ends_at: utcAt(2, 16, 0),
                format: 'IMAX',
                state: 'on_sale',
              },
            ]);

            const rows = await knex('core.showtimes').select('state');
            expect(rows).toHaveLength(4);
          });
        });

        describe('core.ticket_prices', () => {
          it('accepts non-negative BIGINT VND prices and rejects negative amounts and duplicate (showtime_id, seat_type)', async () => {
            const [showtime] = await knex('core.showtimes')
              .insert({
                movie_id: seed.movieId,
                cinema_id: seed.cinemaId,
                auditorium_id: seed.auditoriumAId,
                starts_at: utcAt(3, 10, 0),
                ends_at: utcAt(3, 12, 0),
                format: '2D',
                state: 'on_sale',
              })
              .returning('id');
            const showtimeId = showtime?.id as string;

            const inserted = await knex('core.ticket_prices')
              .insert([
                { showtime_id: showtimeId, seat_type: 'standard', amount_vnd: 0 },
                { showtime_id: showtimeId, seat_type: 'vip', amount_vnd: '9007199254740993' },
                { showtime_id: showtimeId, seat_type: 'couple', amount_vnd: 150000 },
              ])
              .returning(['seat_type', 'amount_vnd']);

            expect(inserted).toHaveLength(3);
            expect(inserted.find((r) => r.seat_type === 'vip')?.amount_vnd).toBe(
              '9007199254740993',
            );

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

        describe('core.seat_hold_groups & core.seat_holds', () => {
          async function createShowtimeForHold(
            auditoriumId: string,
            startsAt: string,
          ): Promise<string> {
            const [row] = await knex('core.showtimes')
              .insert({
                movie_id: seed.movieId,
                cinema_id: seed.cinemaId,
                auditorium_id: auditoriumId,
                starts_at: startsAt,
                ends_at: shiftIso(startsAt, 2 * 60 * 60 * 1000),
                format: '2D',
                state: 'on_sale',
              })
              .returning('id');
            return row?.id as string;
          }

          it('supports authenticated & guest hold groups, idempotency_key uniqueness, and couple seat-pair integrity', async () => {
            const showtimeId = await createShowtimeForHold(seed.auditoriumAId, utcAt(4, 10, 0));
            const expiresAt = futureIsoFromNow(300_000);

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

            // Couple seat-pair consistency on core.seats & paired physical holds
            const pairSeats = await knex('core.seats')
              .where({ couple_pair_id: seed.seatPairAId })
              .select('id', 'auditorium_id', 'seat_type');
            expect(pairSeats).toHaveLength(2);
            expect(pairSeats.every((s) => s.seat_type === 'couple')).toBe(true);

            // Rejects mismatched couple_pair_id from different auditorium via fk_seats_couple_pair
            await expectPgError(
              knex('core.seats').insert({
                auditorium_id: seed.auditoriumBId,
                row_label: 'D',
                seat_number: 1,
                seat_type: 'couple',
                couple_pair_id: seed.seatPairAId,
              }),
              '23503',
              'fk_seats_couple_pair',
            );

            // Hold both physical seats of the couple pair inside authGroup
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

          it('enforces chk_seat_hold_groups_status_released_at lifecycle invariants', async () => {
            const showtimeId = await createShowtimeForHold(seed.auditoriumAId, utcAt(4, 14, 0));
            const createdAt = new Date().toISOString();
            const expiresAt = shiftIso(createdAt, 300_000);
            const releasedAt = shiftIso(createdAt, 30_000);

            // active status with non-null released_at -> rejected
            await expectPgError(
              knex('core.seat_hold_groups').insert({
                showtime_id: showtimeId,
                owner_ref: 'user:lifecycle-1',
                status: 'active',
                created_at: createdAt,
                expires_at: expiresAt,
                released_at: releasedAt,
              }),
              '23514',
              'chk_seat_hold_groups_status_released_at',
            );

            // released status with null released_at -> rejected
            await expectPgError(
              knex('core.seat_hold_groups').insert({
                showtime_id: showtimeId,
                owner_ref: 'user:lifecycle-2',
                status: 'released',
                created_at: createdAt,
                expires_at: expiresAt,
                released_at: null,
              }),
              '23514',
              'chk_seat_hold_groups_status_released_at',
            );

            // Valid transition: active (released_at=null) -> released (released_at=now)
            const [activeGroup] = await knex('core.seat_hold_groups')
              .insert({
                showtime_id: showtimeId,
                owner_ref: 'user:lifecycle-3',
                status: 'active',
                created_at: createdAt,
                expires_at: expiresAt,
                released_at: null,
              })
              .returning('id');
            expect(activeGroup?.id).toBeDefined();

            await expectPgError(
              knex('core.seat_hold_groups')
                .where({ id: activeGroup?.id })
                .update({ status: 'released', released_at: null }),
              '23514',
              'chk_seat_hold_groups_status_released_at',
            );

            const [releasedGroup] = await knex('core.seat_hold_groups')
              .where({ id: activeGroup?.id })
              .update({ status: 'released', released_at: releasedAt })
              .returning(['status', 'released_at']);
            expect(releasedGroup?.status).toBe('released');
            expect(releasedGroup?.released_at).not.toBeNull();

            // confirmed and expired remain compatible with either null or non-null released_at
            const insertedTerminal = await knex('core.seat_hold_groups')
              .insert([
                {
                  showtime_id: showtimeId,
                  owner_ref: 'user:lifecycle-4',
                  status: 'confirmed',
                  created_at: createdAt,
                  expires_at: expiresAt,
                  released_at: null,
                },
                {
                  showtime_id: showtimeId,
                  owner_ref: 'user:lifecycle-5',
                  status: 'expired',
                  created_at: createdAt,
                  expires_at: expiresAt,
                  released_at: null,
                },
              ])
              .returning('status');
            expect(insertedTerminal).toHaveLength(2);
          });

          it('rejects invalid expiration, duplicate seat in same hold group, and invalid/cross-auditorium FKs', async () => {
            const showtimeAId = await createShowtimeForHold(seed.auditoriumAId, utcAt(5, 10, 0));
            const showtimeBId = await createShowtimeForHold(seed.auditoriumBId, utcAt(5, 10, 0));

            const tCreated = utcAt(5, 9, 0);
            const tExpires = shiftIso(tCreated, 5 * 60_000);
            const tBefore = shiftIso(tCreated, -60_000);
            const liveExpiresAt = futureIsoFromNow(300_000);

            // expires_at <= created_at on seat_hold_groups
            await expectPgError(
              knex('core.seat_hold_groups').insert({
                showtime_id: showtimeAId,
                owner_ref: 'user:99',
                created_at: tCreated,
                expires_at: tCreated,
              }),
              '23514',
              'chk_seat_hold_groups_expires_after_created',
            );

            const [groupA] = await knex('core.seat_hold_groups')
              .insert({
                showtime_id: showtimeAId,
                owner_ref: 'user:99',
                created_at: tCreated,
                expires_at: tExpires,
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
                created_at: tCreated,
                expires_at: tBefore,
              }),
              '23514',
              'chk_seat_holds_expires_after_created',
            );

            // Insert valid seatA1Id using live relative future expires_at
            await knex('core.seat_holds').insert({
              hold_group_id: groupAId,
              showtime_id: showtimeAId,
              auditorium_id: seed.auditoriumAId,
              seat_id: seed.seatA1Id,
              expires_at: liveExpiresAt,
            });

            // Duplicate seat_id inside same hold_group_id
            await expectPgError(
              knex('core.seat_holds').insert({
                hold_group_id: groupAId,
                showtime_id: showtimeAId,
                auditorium_id: seed.auditoriumAId,
                seat_id: seed.seatA1Id,
                status: 'released',
                expires_at: liveExpiresAt,
              }),
              '23505',
              'uq_seat_holds_group_seat',
            );

            // Missing showtime_id FK on seat_hold_groups
            await expectPgError(
              knex('core.seat_hold_groups').insert({
                showtime_id: randomUUID(),
                owner_ref: 'user:99',
                created_at: tCreated,
                expires_at: tExpires,
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
                expires_at: liveExpiresAt,
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
                expires_at: liveExpiresAt,
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
                expires_at: liveExpiresAt,
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
                expires_at: liveExpiresAt,
              }),
              '23503',
              'fk_seat_holds_group_showtime',
            );
          });

          it('prevents concurrent active hold inserts for the same (showtime_id, seat_id) across two connections (23505)', async () => {
            const showtimeId = await createShowtimeForHold(seed.auditoriumAId, utcAt(6, 10, 0));
            const expiresAt = futureIsoFromNow(300_000);

            const [g1] = await knex('core.seat_hold_groups')
              .insert({
                showtime_id: showtimeId,
                owner_ref: 'user:101',
                expires_at: expiresAt,
              })
              .returning('id');
            const [g2] = await knex('core.seat_hold_groups')
              .insert({
                showtime_id: showtimeId,
                owner_ref: 'user:102',
                expires_at: expiresAt,
              })
              .returning('id');

            const client1 = new pg.Client({ connectionString: contractDbUrl });
            const client2 = new pg.Client({ connectionString: contractDbUrl });
            await Promise.all([client1.connect(), client2.connect()]);

            try {
              const sql = `
                INSERT INTO core.seat_holds (hold_group_id, showtime_id, auditorium_id, seat_id, status, expires_at)
                VALUES ($1, $2, $3, $4, 'active', $5)
                RETURNING id
              `;

              const results = await Promise.allSettled([
                client1.query(sql, [
                  g1?.id,
                  showtimeId,
                  seed.auditoriumAId,
                  seed.seatA1Id,
                  expiresAt,
                ]),
                client2.query(sql, [
                  g2?.id,
                  showtimeId,
                  seed.auditoriumAId,
                  seed.seatA1Id,
                  expiresAt,
                ]),
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
                  expires_at: futureIsoFromNow(300_000),
                })
                .returning('id');

              const [reheld] = await knex('core.seat_holds')
                .insert({
                  hold_group_id: g3?.id,
                  showtime_id: showtimeId,
                  auditorium_id: seed.auditoriumAId,
                  seat_id: seed.seatA1Id,
                  status: 'active',
                  expires_at: futureIsoFromNow(300_000),
                })
                .returning('id');
              expect(reheld?.id).toBeDefined();
            } finally {
              await Promise.all([client1.end(), client2.end()]);
            }
          });
        });

        describe('core.seat_allocations', () => {
          async function createShowtimeAndBookingsForAllocation(): Promise<{
            showtimeId: string;
            holdGroup1Id: string;
            holdGroup2Id: string;
            booking1Id: string;
            booking2Id: string;
          }> {
            await provisionProvisionalBo01Tables(knex);

            const [showtime] = await knex('core.showtimes')
              .insert({
                movie_id: seed.movieId,
                cinema_id: seed.cinemaId,
                auditorium_id: seed.auditoriumAId,
                starts_at: utcAt(7, 10, 0),
                ends_at: utcAt(7, 12, 0),
                format: '2D',
                state: 'on_sale',
              })
              .returning('id');
            const showtimeId = showtime?.id as string;

            const expiresAt = futureIsoFromNow(300_000);
            const [group1] = await knex('core.seat_hold_groups')
              .insert({
                showtime_id: showtimeId,
                owner_ref: 'user:200',
                status: 'confirmed',
                expires_at: expiresAt,
              })
              .returning('id');
            const [group2] = await knex('core.seat_hold_groups')
              .insert({
                showtime_id: showtimeId,
                owner_ref: 'user:201',
                status: 'confirmed',
                expires_at: expiresAt,
              })
              .returning('id');

            const holdGroup1Id = group1?.id as string;
            const holdGroup2Id = group2?.id as string;
            const booking1Id = await createProvisionalBooking(knex, { holdGroupId: holdGroup1Id });
            const booking2Id = await createProvisionalBooking(knex, { holdGroupId: holdGroup2Id });

            return { showtimeId, holdGroup1Id, holdGroup2Id, booking1Id, booking2Id };
          }

          it('rejects duplicate active allocation, wrong-auditorium seat, invalid booking_id FK, and allows reallocation after soft cancellation', async () => {
            const { showtimeId, holdGroup1Id, booking1Id, booking2Id } =
              await createShowtimeAndBookingsForAllocation();

            try {
              const [alloc1] = await knex('core.seat_allocations')
                .insert({
                  showtime_id: showtimeId,
                  auditorium_id: seed.auditoriumAId,
                  seat_id: seed.seatA1Id,
                  booking_id: booking1Id,
                  hold_group_id: holdGroup1Id,
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
                  booking_id: booking2Id,
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
                  booking_id: booking2Id,
                  status: 'active',
                }),
                '23503',
                'fk_seat_allocations_seat_auditorium',
              );

              // Nonexistent booking_id rejected by deferred BO-01 fk_seat_allocations_booking
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
                  booking_id: booking2Id,
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
            } finally {
              await knex.raw('TRUNCATE TABLE core.seat_allocations, core.bookings CASCADE');
              await dropProvisionalBo01Tables(knex);
            }
          });

          it('prevents concurrent duplicate active allocations across two connections (1 succeeds, 1 fails 23505)', async () => {
            const { showtimeId, booking1Id, booking2Id } =
              await createShowtimeAndBookingsForAllocation();
            const client1 = new pg.Client({ connectionString: contractDbUrl });
            const client2 = new pg.Client({ connectionString: contractDbUrl });
            await Promise.all([client1.connect(), client2.connect()]);

            try {
              const sql = `
                INSERT INTO core.seat_allocations (showtime_id, auditorium_id, seat_id, booking_id, status)
                VALUES ($1, $2, $3, $4, 'active')
                RETURNING id
              `;

              const results = await Promise.allSettled([
                client1.query(sql, [showtimeId, seed.auditoriumAId, seed.seatA2Id, booking1Id]),
                client2.query(sql, [showtimeId, seed.auditoriumAId, seed.seatA2Id, booking2Id]),
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
              await knex.raw('TRUNCATE TABLE core.seat_allocations, core.bookings CASCADE');
              await dropProvisionalBo01Tables(knex);
            }
          });
        });
      });
    });
  },
);
