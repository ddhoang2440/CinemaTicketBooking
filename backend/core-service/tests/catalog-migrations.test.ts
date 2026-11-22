import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * CA-01 — Migration Schema Tests (unit-level, no DB required)
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * Verifies migration files exist, export correct signatures,
 * and validates catalog schema constraints and couple seat pair rules (D-15).
 */

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname ?? __dirname,
  '../db/migrations',
);

const CA01_MIGRATIONS = [
  '20261122160000_create_movies_table.ts',
  '20261122160100_create_cinemas_table.ts',
  '20261122160200_create_auditoriums_table.ts',
  '20261122160300_create_seat_pairs_table.ts',
  '20261122160400_create_seats_table.ts',
  '20261122160500_add_users_cinema_fk.ts',
];

describe('CA-01 — Catalog & seat_pairs migrations', () => {
  describe('Migration files exist and have correct exports', () => {
    for (const fileName of CA01_MIGRATIONS) {
      it(`${fileName} exists in db/migrations/`, () => {
        const filePath = path.join(MIGRATIONS_DIR, fileName);
        expect(fs.existsSync(filePath)).toBe(true);
      });
    }

    it('all migration files export up() and down() functions', async () => {
      for (const fileName of CA01_MIGRATIONS) {
        const filePath = path.join(MIGRATIONS_DIR, fileName);
        const mod = await import(filePath);
        expect(typeof mod.up).toBe('function');
        expect(typeof mod.down).toBe('function');
      }
    });
  });

  describe('Migration ordering', () => {
    it('CA-01 migrations are ordered correctly (movies → cinemas → auditoriums → seat_pairs → seats → users_fk)', () => {
      const timestamps = CA01_MIGRATIONS.map((f) => {
        const prefix = f.split('_')[0];
        return parseInt(prefix ?? '0', 10);
      });
      for (let i = 1; i < timestamps.length; i++) {
        const current = timestamps[i] ?? 0;
        const previous = timestamps[i - 1] ?? 0;
        expect(current).toBeGreaterThan(previous);
      }
    });

    it('CA-01 migrations run after TV1 auth migrations (timestamp ordering)', () => {
      const tv1LastTimestamp = parseInt(
        '20261119153952', // last TV1 migration: password_resets
        10,
      );
      const ca01FirstTimestamp = parseInt(
        '20261122160000', // first CA-01 migration: movies
        10,
      );

      expect(ca01FirstTimestamp).toBeGreaterThan(tv1LastTimestamp);
    });
  });

  describe('Schema content validation (source code inspection)', () => {
    it('movies migration includes duration_min > 0 check constraint', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160000_create_movies_table.ts'),
        'utf-8',
      );
      expect(content).toContain('checkPositive');
      expect(content).toContain('ck_movies_duration_positive');
    });

    it('movies migration includes valid status check constraint', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160000_create_movies_table.ts'),
        'utf-8',
      );
      expect(content).toContain('active');
      expect(content).toContain('coming_soon');
      expect(content).toContain('inactive');
      expect(content).toContain('ck_movies_status_valid');
    });

    it('movies migration uses UUID primary key', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160000_create_movies_table.ts'),
        'utf-8',
      );
      expect(content).toContain("uuid('id')");
      expect(content).toContain('.primary()');
      expect(content).toContain('uuid_generate_v4');
    });

    it('movies migration uses timestamptz for created_at/updated_at (D-18)', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160000_create_movies_table.ts'),
        'utf-8',
      );
      expect(content).toContain('useTz: true');
      expect(content).toContain('created_at');
      expect(content).toContain('updated_at');
    });

    it('cinemas migration has name + address index', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160100_create_cinemas_table.ts'),
        'utf-8',
      );
      expect(content).toContain('idx_cinemas_name_address');
    });

    it('auditoriums migration enforces unique(cinema_id, name)', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160200_create_auditoriums_table.ts'),
        'utf-8',
      );
      expect(content).toContain('uq_auditoriums_cinema_name');
      expect(content).toContain("'cinema_id', 'name'");
    });

    it('auditoriums migration has FK to cinemas with RESTRICT delete', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160200_create_auditoriums_table.ts'),
        'utf-8',
      );
      expect(content).toContain("references('id')");
      expect(content).toContain("inTable('cinemas')");
      expect(content).toContain("onDelete('RESTRICT')");
    });

    it('auditoriums migration supports screening formats array', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160200_create_auditoriums_table.ts'),
        'utf-8',
      );
      expect(content).toContain('supported_formats');
      expect(content).toContain("'text[]'");
    });

    it('seat_pairs migration has composite unique(id, auditorium_id) for D-15', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160300_create_seat_pairs_table.ts'),
        'utf-8',
      );
      expect(content).toContain('uq_seat_pairs_id_auditorium');
      expect(content).toContain("'id', 'auditorium_id'");
    });

    it('seats migration has unique(auditorium_id, row_label, seat_number) — no duplicate positions', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160400_create_seats_table.ts'),
        'utf-8',
      );
      expect(content).toContain('uq_seats_auditorium_position');
      expect(content).toContain("'auditorium_id', 'row_label', 'seat_number'");
    });

    it('seats migration has valid seat_type check constraint (standard, vip, couple)', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160400_create_seats_table.ts'),
        'utf-8',
      );
      expect(content).toContain('standard');
      expect(content).toContain('vip');
      expect(content).toContain('couple');
      expect(content).toContain('ck_seats_type_valid');
    });

    it('seats migration enforces couple_pair_id consistency check (D-15)', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160400_create_seats_table.ts'),
        'utf-8',
      );
      expect(content).toContain('ck_seats_couple_pair_consistency');
      expect(content).toContain("seat_type = 'couple' AND couple_pair_id IS NOT NULL");
      expect(content).toContain("seat_type <> 'couple' AND couple_pair_id IS NULL");
    });

    it('seats migration references seat_pairs table for couple_pair_id FK', async () => {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, '20261122160400_create_seats_table.ts'),
        'utf-8',
      );
      expect(content).toContain("inTable('seat_pairs')");
      expect(content).toContain("uuid('couple_pair_id')");
    });
  });
});

describe('CA-01 — Seed data validation', () => {
  const SEEDS_DIR = path.resolve(
    import.meta.dirname ?? __dirname,
    '../db/seeds',
  );

  it('01_catalog seed file exists', () => {
    const seedPath = path.join(SEEDS_DIR, '01_catalog.ts');
    expect(fs.existsSync(seedPath)).toBe(true);
  });

  it('seed file exports a seed() function', async () => {
    const seedPath = path.join(SEEDS_DIR, '01_catalog.ts');
    const mod = await import(seedPath);
    expect(typeof mod.seed).toBe('function');
  });

  describe('Couple seat pair correctness (D-15)', () => {
    it('seed data creates exactly 2 seats per couple_pair_id', () => {
      // Parse the seed file and validate couple pair consistency
      const content = fs.readFileSync(
        path.join(SEEDS_DIR, '01_catalog.ts'),
        'utf-8',
      );

      // Extract all couple_pair_id references for seats with seat_type: 'couple'
      const coupleSeats: { pairId: string; row: string; num: number }[] = [];

      // Find couple seat entries in the seed
      const couplePattern =
        /seat_type:\s*'couple',\s*\n\s*couple_pair_id:\s*([\w.]+)/g;
      let match;
      while ((match = couplePattern.exec(content)) !== null) {
        const pairId = match[1];
        if (pairId) {
          coupleSeats.push({
            pairId,
            row: '',
            num: 0,
          });
        }
      }

      // Count seats per pair ID reference
      const pairCounts = new Map<string, number>();
      for (const seat of coupleSeats) {
        const count = pairCounts.get(seat.pairId) ?? 0;
        pairCounts.set(seat.pairId, count + 1);
      }

      // Every couple pair must have exactly 2 seats
      for (const [pairRef, count] of pairCounts) {
        expect(count, `Couple pair ${pairRef} should have exactly 2 seats`).toBe(2);
      }

      // We should have at least some couple pairs
      expect(pairCounts.size).toBeGreaterThanOrEqual(3);
    });

    it('seed data assigns no couple_pair_id to non-couple seats', () => {
      const content = fs.readFileSync(
        path.join(SEEDS_DIR, '01_catalog.ts'),
        'utf-8',
      );

      // Standard and VIP seats should have couple_pair_id: null
      const standardVipPattern =
        /seat_type:\s*'(standard|vip)',\s*\n\s*couple_pair_id:\s*(\w+)/g;
      let match;
      while ((match = standardVipPattern.exec(content)) !== null) {
        expect(
          match[2],
          `${match[1]} seat should have couple_pair_id: null`,
        ).toBe('null');
      }
    });
  });

  it('seed data includes Vietnamese cinema metadata', () => {
    const content = fs.readFileSync(
      path.join(SEEDS_DIR, '01_catalog.ts'),
      'utf-8',
    );
    // Vietnamese content
    expect(content).toContain('Hồ Chí Minh');
    expect(content).toContain('Tiếng Việt');
  });

  it('seed data includes movies with valid age_rating', () => {
    const content = fs.readFileSync(
      path.join(SEEDS_DIR, '01_catalog.ts'),
      'utf-8',
    );
    // Check valid age ratings are used
    const validRatings = ['P', 'C13', 'C16', 'C18'];
    const ratingPattern = /age_rating:\s*'(\w+)'/g;
    let match;
    while ((match = ratingPattern.exec(content)) !== null) {
      expect(validRatings).toContain(match[1]);
    }
  });

  it('seed data includes at least 3 auditoriums across 2 cinemas', () => {
    const content = fs.readFileSync(
      path.join(SEEDS_DIR, '01_catalog.ts'),
      'utf-8',
    );
    // Count cinema IDs
    const cinemaIdPattern = /cinema\d/g;
    const cinemaIds = new Set<string>();
    let match;
    while ((match = cinemaIdPattern.exec(content)) !== null) {
      cinemaIds.add(match[0]);
    }
    expect(cinemaIds.size).toBeGreaterThanOrEqual(2);

    // Count auditorium IDs
    const audIdPattern = /aud\d/g;
    const audIds = new Set<string>();
    while ((match = audIdPattern.exec(content)) !== null) {
      audIds.add(match[0]);
    }
    expect(audIds.size).toBeGreaterThanOrEqual(3);
  });
});
