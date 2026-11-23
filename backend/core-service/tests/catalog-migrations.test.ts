import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory, { type Knex } from 'knex';
import pg from 'pg';
import {
  MOVIE_IDS,
  CINEMA_IDS,
  AUDITORIUM_IDS,
  SEAT_PAIR_IDS,
  seed as seedCatalog,
} from '../db/seeds/01_catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

/**
 * CA-01 Unit & PostgreSQL 17 Integration Verification Tests
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * Verifies:
 *   1. All 6 CA-01 migration files exist, use gen_random_uuid(), explicit .withSchema('core'),
 *      and export up/down functions.
 *   2. Migration execution order respects FK dependencies:
 *      movies -> cinemas -> auditoriums -> seat_pairs -> seats -> users.cinema_id FK.
 *   3. Seed file exports deterministic UUIDs, uses idempotent ON CONFLICT upserts (no .del()),
 *      and respects D-15 couple seat rules.
 *   4. Real PostgreSQL 17 integration tests verify composite unique keys
 *      uq_auditoriums_id_cinema, uq_seats_id_auditorium, composite FK fk_seats_couple_pair,
 *      D-15 couple pair cardinality trigger, and non-destructive re-seeding.
 */

const CA01_MIGRATIONS = [
  '20261122160000_create_movies_table.ts',
  '20261122160100_create_cinemas_table.ts',
  '20261122160200_create_auditoriums_table.ts',
  '20261122160300_create_seat_pairs_table.ts',
  '20261122160400_create_seats_table.ts',
  '20261122160500_add_users_cinema_fk.ts',
] as const;

describe('CA-01 — Catalog & Cinema Migrations (TV2)', () => {
  describe('Migration files structure & ordering', () => {
    it.each(CA01_MIGRATIONS)('migration file %s exists on disk', (fileName) => {
      const filePath = path.join(MIGRATIONS_DIR, fileName);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it.each(CA01_MIGRATIONS)(
      'migration %s exports up and down functions',
      async (fileName) => {
        const filePath = path.join(MIGRATIONS_DIR, fileName);
        const mod = await import(filePath);
        expect(typeof mod.up).toBe('function');
        expect(typeof mod.down).toBe('function');
      },
    );

    it('CA-01 migrations run in correct dependency order (timestamps ascending)', () => {
      const timestamps = CA01_MIGRATIONS.map((f) => f.split('_')[0]!);
      const sorted = [...timestamps].sort();
      expect(timestamps).toEqual(sorted);
    });

    it('CA-01 migrations run after TV1 auth migrations (20261119*)', () => {
      const tv1LastTimestamp = '20261119153952'; // last TV1 migration: password_resets
      const ca01FirstTimestamp = CA01_MIGRATIONS[0].split('_')[0]!;
      expect(ca01FirstTimestamp > tv1LastTimestamp).toBe(true);
    });
  });

  describe('SQL / Schema constraints verification (static analysis)', () => {
    it('movies migration includes chk_movies_duration_positive (duration_min > 0)', () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160000_create_movies_table.ts'),
        'utf-8',
      );
      expect(content).toContain('chk_movies_duration_positive');
      expect(content).toContain('duration_min > 0');
      expect(content).toContain("withSchema('core')");
    });

    it('movies migration uses timestamptz (useTz: true)', () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160000_create_movies_table.ts'),
        'utf-8',
      );
      expect(content).toContain('useTz: true');
    });

    it('movies migration uses UUID primary key with gen_random_uuid()', () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160000_create_movies_table.ts'),
        'utf-8',
      );
      expect(content).toContain("table\n      .uuid('id')");
      expect(content).toContain('gen_random_uuid()');
      expect(content).not.toContain('uuid_generate_v4()');
    });

    it('cinemas migration indexes (name, address) per ERD §2.1', () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160100_create_cinemas_table.ts'),
        'utf-8',
      );
      expect(content).toContain('idx_cinemas_name_address');
      expect(content).toContain("['name', 'address']");
      expect(content).toContain("withSchema('core')");
    });

    it('auditoriums migration enforces unique(cinema_id, name) and unique(id, cinema_id)', () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160200_create_auditoriums_table.ts'),
        'utf-8',
      );
      expect(content).toContain('uq_auditoriums_cinema_name');
      expect(content).toContain("['cinema_id', 'name']");
      expect(content).toContain('uq_auditoriums_id_cinema');
      expect(content).toContain("['id', 'cinema_id']");
    });

    it('auditoriums migration indexes cinema_id FK per ERD §1', () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160200_create_auditoriums_table.ts'),
        'utf-8',
      );
      expect(content).toContain('idx_auditoriums_cinema_id');
      expect(content).toContain("inTable('core.cinemas')");
    });

    it('seat_pairs migration enforces unique(id, auditorium_id) per D-15', () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160300_create_seat_pairs_table.ts'),
        'utf-8',
      );
      expect(content).toContain('uq_seat_pairs_id_auditorium');
      expect(content).toContain("['id', 'auditorium_id']");
      expect(content).toContain("inTable('core.auditoriums')");
    });

    it('seats migration enforces unique(auditorium_id, row_label, seat_number) and unique(id, auditorium_id)', () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160400_create_seats_table.ts'),
        'utf-8',
      );
      expect(content).toContain('uq_seats_auditorium_position');
      expect(content).toContain("['auditorium_id', 'row_label', 'seat_number']");
      expect(content).toContain('uq_seats_id_auditorium');
      expect(content).toContain("['id', 'auditorium_id']");
    });

    it('seats migration enforces seat_type check (standard, vip, couple)', () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160400_create_seats_table.ts'),
        'utf-8',
      );
      expect(content).toContain('chk_seats_seat_type');
      expect(content).toContain("'standard', 'vip', 'couple'");
    });

    it('seats migration enforces couple_pair_id consistency check and composite FK (D-15)', () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160400_create_seats_table.ts'),
        'utf-8',
      );
      expect(content).toContain('chk_seats_couple_pair_consistency');
      expect(content).toContain("seat_type = 'couple' AND couple_pair_id IS NOT NULL");
      expect(content).toContain("seat_type <> 'couple' AND couple_pair_id IS NULL");
      expect(content).toContain("foreign(['couple_pair_id', 'auditorium_id'], 'fk_seats_couple_pair')");
      expect(content).toContain("references(['id', 'auditorium_id'])");
      expect(content).toContain("inTable('core.seat_pairs')");
    });
  });

  describe('Seed data integrity (01_catalog.ts)', () => {
    it('exports valid UUID v4 constants for movies, cinemas, auditoriums, seat_pairs', () => {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      for (const id of Object.values(MOVIE_IDS)) {
        expect(id).toMatch(uuidRegex);
      }
      for (const id of Object.values(CINEMA_IDS)) {
        expect(id).toMatch(uuidRegex);
      }
      for (const id of Object.values(AUDITORIUM_IDS)) {
        expect(id).toMatch(uuidRegex);
      }
      for (const id of Object.values(SEAT_PAIR_IDS)) {
        expect(id).toMatch(uuidRegex);
      }
    });

    it('seed data creates exactly 2 seats per couple_pair_id and uses idempotent upserts without .del()', () => {
      const seedContent = fs.readFileSync(
        path.resolve(__dirname, '../db/seeds/01_catalog.ts'),
        'utf-8',
      );

      expect(seedContent).not.toContain('.del()');
      expect(seedContent).toContain('.onConflict(');

      const coupleSeatRegex =
        /seat_type:\s*'couple',\s*\n\s*couple_pair_id:\s*([\w.]+)/g;
      const pairCounts = new Map<string, number>();

      let match: RegExpExecArray | null;
      while ((match = coupleSeatRegex.exec(seedContent)) !== null) {
        const pairRef = match[1]!;
        pairCounts.set(pairRef, (pairCounts.get(pairRef) ?? 0) + 1);
      }

      expect(pairCounts.size).toBe(Object.keys(SEAT_PAIR_IDS).length);

      for (const [pairRef, count] of pairCounts.entries()) {
        expect(count, `${pairRef} must have exactly 2 seats (D-15)`).toBe(2);
      }
    });

    it('seed data assigns no couple_pair_id to non-couple seats', () => {
      const seedContent = fs.readFileSync(
        path.resolve(__dirname, '../db/seeds/01_catalog.ts'),
        'utf-8',
      );

      const nonCoupleWithPairRegex =
        /seat_type:\s*'(standard|vip)',\s*\n\s*couple_pair_id:\s*(\w+)/g;

      let match: RegExpExecArray | null;
      while ((match = nonCoupleWithPairRegex.exec(seedContent)) !== null) {
        expect(
          match[2],
          `${match[1]} seat should have couple_pair_id: null`,
        ).toBe('null');
      }
    });
  });
});

// ── Real PostgreSQL 17 Integration Suite for CA-01 ─────────────────────────
const pgAdminUrl =
  process.env.CA01_TEST_DATABASE_URL ??
  process.env.SH01_TEST_DATABASE_URL ??
  process.env.BO01_TEST_DATABASE_URL;

function urlForDatabase(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

describe.skipIf(!pgAdminUrl)('CA-01 PostgreSQL 17 Integration Verification', () => {
  const dbName = `ca01_int_${randomBytes(4).toString('hex')}`;
  let adminClient: pg.Client;
  let knex: Knex;

  beforeAll(async () => {
    adminClient = new pg.Client({ connectionString: pgAdminUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);

    knex = knexFactory({
      client: 'pg',
      connection: urlForDatabase(pgAdminUrl ?? '', dbName),
      searchPath: ['core', 'public'],
      pool: { min: 1, max: 4 },
    });

    await knex.raw('CREATE SCHEMA IF NOT EXISTS core');
    for (const file of CA01_MIGRATIONS) {
      const mod = (await import(path.join(MIGRATIONS_DIR, file))) as {
        up: (k: Knex) => Promise<void>;
      };
      await mod.up(knex);
    }
  }, 60_000);

  afterAll(async () => {
    await knex?.destroy();
    if (adminClient) {
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await adminClient.end();
    }
  }, 30_000);

  it('creates all 5 catalog tables in schema core with composite unique indexes required by SH-01', async () => {
    const indexes = await knex.raw(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'core'
    `);
    const have = new Set(indexes.rows.map((r: { indexname: string }) => r.indexname));
    expect(have).toContain('uq_auditoriums_id_cinema');
    expect(have).toContain('uq_auditoriums_cinema_name');
    expect(have).toContain('uq_seat_pairs_id_auditorium');
    expect(have).toContain('uq_seats_id_auditorium');
    expect(have).toContain('uq_seats_auditorium_position');
  });

  it('runs 01_catalog.ts seed idempotently twice without deleting or altering existing seat IDs', async () => {
    await seedCatalog(knex);
    const firstSeats = await knex('core.seats')
      .select('id', 'auditorium_id', 'row_label', 'seat_number')
      .orderBy(['auditorium_id', 'row_label', 'seat_number']);
    expect(firstSeats).toHaveLength(80);

    // Re-run seed a second time; seat IDs must remain identical
    await seedCatalog(knex);
    const secondSeats = await knex('core.seats')
      .select('id', 'auditorium_id', 'row_label', 'seat_number')
      .orderBy(['auditorium_id', 'row_label', 'seat_number']);
    expect(secondSeats).toEqual(firstSeats);
  });

  it('rejects cross-auditorium couple_pair_id assignment and >2 seats per couple_pair_id (D-15)', async () => {
    // Attempt to assign pair1_aud1 (belongs to hcm_q1_room1) to a seat in hcm_q1_room2
    await expect(
      knex('core.seats').insert({
        id: randomUUID(),
        auditorium_id: AUDITORIUM_IDS.hcm_q1_room2,
        row_label: 'Z',
        seat_number: 1,
        seat_type: 'couple',
        couple_pair_id: SEAT_PAIR_IDS.pair1_aud1,
      }),
    ).rejects.toThrow();

    // Attempt to add a 3rd seat to pair1_aud1 in the same auditorium hcm_q1_room1
    await expect(
      knex('core.seats').insert({
        id: randomUUID(),
        auditorium_id: AUDITORIUM_IDS.hcm_q1_room1,
        row_label: 'D',
        seat_number: 99,
        seat_type: 'couple',
        couple_pair_id: SEAT_PAIR_IDS.pair1_aud1,
      }),
    ).rejects.toThrow(/already links 2 seats/);
  });

  it('rolls back all CA-01 migrations cleanly and re-applies them', async () => {
    for (const file of [...CA01_MIGRATIONS].reverse()) {
      const mod = (await import(path.join(MIGRATIONS_DIR, file))) as {
        down: (k: Knex) => Promise<void>;
      };
      await mod.down(knex);
    }

    const remaining = await knex.raw(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'core'
        AND table_name IN ('movies', 'cinemas', 'auditoriums', 'seat_pairs', 'seats')
    `);
    expect(remaining.rows).toHaveLength(0);

    for (const file of CA01_MIGRATIONS) {
      const mod = (await import(path.join(MIGRATIONS_DIR, file))) as {
        up: (k: Knex) => Promise<void>;
      };
      await mod.up(knex);
    }
    await seedCatalog(knex);
    const moviesCount = await knex('core.movies').count<{ count: string }[]>('* as count');
    expect(Number(moviesCount[0]?.count)).toBe(5);
  });
});
