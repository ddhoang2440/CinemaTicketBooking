import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory from 'knex';
import type { Knex } from 'knex';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed as seedConcessions } from '../db/seeds/05_concessions.js';
import { seed as seedRoles } from '../db/seeds/00_roles.js';
import { seed as seedCatalog } from '../db/seeds/01_catalog.js';

// Needs a PostgreSQL superuser URL (any database); the suite creates and drops its own database.
const adminUrl =
  process.env.BO01_TEST_DATABASE_URL ??
  process.env.SH01_TEST_DATABASE_URL;

const coreServiceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(coreServiceDir, 'db', 'migrations');

interface PgErrorShape {
  code?: string;
  constraint?: string;
}

async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    const pgErr = error as PgErrorShape;
    expect(pgErr.code).toBe(code);
    if (constraint !== undefined) {
      expect(pgErr.constraint).toBe(constraint);
    }
    return;
  }
  throw new Error(`Expected PostgreSQL error ${code}, but the statement succeeded`);
}

function urlForDatabase(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function hex(bytes = 4): string {
  return randomBytes(bytes).toString('hex');
}

describe.skipIf(!adminUrl)(
  'BO-01 core migrations against real merged schema (ID-01 + CA-01 + SH-01 + BO-01)',
  () => {
    const dbName = `bo01_core_${hex()}`;
    let admin: pg.Client;
    let knex: Knex;

    let userId: string;
    let cinemaId: string;
    let auditoriumId: string;
    let otherAuditoriumId: string;
    let showtimeId: string;
    let otherShowtimeId: string;
    let seatAId: string;
    let seatBId: string;
    let otherAuditoriumSeatId: string;

    async function newUser(): Promise<string> {
      const [u] = await knex('core.users')
        .insert({
          email: `bo01_${hex()}@cinema.local`,
          password_hash: 'argon2id$hash',
          full_name: 'BO-01 Customer',
        })
        .returning('id');
      return u.id as string;
    }

    async function newHoldGroup(targetShowtimeId = showtimeId): Promise<string> {
      const [row] = await knex('core.seat_hold_groups')
        .insert({
          showtime_id: targetShowtimeId,
          owner_ref: `guest:${hex(6)}`,
          status: 'active',
          expires_at: new Date(Date.now() + 300_000).toISOString(),
        })
        .returning('id');
      return row.id as string;
    }

    async function insertBooking(overrides: Record<string, unknown> = {}): Promise<string> {
      const holdGroupId = (overrides.hold_group_id as string | undefined) ?? (await newHoldGroup());
      const [row] = await knex('core.bookings')
        .insert({
          booking_code: `BK${hex(6).toUpperCase()}`,
          user_id: null,
          contact_name: 'Nguyễn Văn A',
          contact_email: 'a@cinema.local',
          guest_token_hash: `guest_sha256_${hex(8)}`,
          hold_group_id: holdGroupId,
          idempotency_key: `idem_${hex(8)}`,
          total_vnd: 90000,
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          ...overrides,
        })
        .returning('id');
      return row.id as string;
    }

    beforeAll(async () => {
      const client = new pg.Client({ connectionString: adminUrl });
      await client.connect();
      admin = client;
      await admin.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);

      knex = knexFactory({
        client: 'pg',
        connection: urlForDatabase(adminUrl ?? '', dbName),
        searchPath: ['core', 'public'],
        pool: { min: 1, max: 5 },
        migrations: {
          directory: migrationsDir,
          schemaName: 'core',
          tableName: 'knex_migrations',
          extension: 'ts',
          loadExtensions: ['.ts'],
        },
      });

      await knex.raw('CREATE SCHEMA IF NOT EXISTS core');
      await knex.raw('CREATE EXTENSION IF NOT EXISTS "btree_gist"');
      await knex.migrate.latest();

      await seedRoles(knex);
      await seedCatalog(knex);

      userId = await newUser();

      const [movie] = await knex('core.movies')
        .insert({ title: 'BO-01 Test Movie', duration_min: 120, status: 'active' })
        .returning('id');
      const [cinema] = await knex('core.cinemas')
        .insert({ name: 'BO-01 Cinema', address: '1 Lê Lợi', city: 'HCM', status: 'active' })
        .returning('id');
      cinemaId = cinema.id as string;

      const [aud1] = await knex('core.auditoriums')
        .insert({
          cinema_id: cinemaId,
          name: 'BO-01 Hall 1',
          total_seats: 10,
          supported_formats: ['2D'],
          status: 'active',
        })
        .returning('id');
      auditoriumId = aud1.id as string;

      const [aud2] = await knex('core.auditoriums')
        .insert({
          cinema_id: cinemaId,
          name: 'BO-01 Hall 2',
          total_seats: 10,
          supported_formats: ['2D'],
          status: 'active',
        })
        .returning('id');
      otherAuditoriumId = aud2.id as string;

      const [sA] = await knex('core.seats')
        .insert({
          auditorium_id: auditoriumId,
          row_label: 'A',
          seat_number: 1,
          seat_type: 'standard',
          couple_pair_id: null,
        })
        .returning('id');
      seatAId = sA.id as string;

      const [sB] = await knex('core.seats')
        .insert({
          auditorium_id: auditoriumId,
          row_label: 'A',
          seat_number: 2,
          seat_type: 'standard',
          couple_pair_id: null,
        })
        .returning('id');
      seatBId = sB.id as string;

      const [sOther] = await knex('core.seats')
        .insert({
          auditorium_id: otherAuditoriumId,
          row_label: 'A',
          seat_number: 1,
          seat_type: 'standard',
          couple_pair_id: null,
        })
        .returning('id');
      otherAuditoriumSeatId = sOther.id as string;

      const [st1] = await knex('core.showtimes')
        .insert({
          movie_id: movie.id,
          cinema_id: cinemaId,
          auditorium_id: auditoriumId,
          starts_at: '2026-12-20T12:30:00Z',
          ends_at: '2026-12-20T14:30:00Z',
          format: '2D',
          state: 'on_sale',
        })
        .returning('id');
      showtimeId = st1.id as string;

      const [st2] = await knex('core.showtimes')
        .insert({
          movie_id: movie.id,
          cinema_id: cinemaId,
          auditorium_id: otherAuditoriumId,
          starts_at: '2026-12-20T16:00:00Z',
          ends_at: '2026-12-20T18:00:00Z',
          format: '2D',
          state: 'on_sale',
        })
        .returning('id');
      otherShowtimeId = st2.id as string;
    }, 60_000);

    afterAll(async () => {
      await knex?.destroy();
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
        await admin.end();
      }
    }, 30_000);

    it('applies all 22 core migrations (including 6 BO-01 migrations) with bigint money, named constraints and no cross-schema FK', async () => {
      const allApplied = await knex('core.knex_migrations');
      expect(allApplied).toHaveLength(22);

      const bo01Applied = await knex('core.knex_migrations').where('name', 'like', '20261122170%');
      expect(bo01Applied).toHaveLength(6);

      const money = await knex.raw(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'core' AND column_name IN ('total_vnd','unit_price_vnd')`,
      );
      expect(money.rows).toHaveLength(4);
      for (const row of money.rows) {
        expect(row.data_type).toBe('bigint');
      }

      const names = await knex.raw(
        `SELECT conname AS n FROM pg_constraint WHERE connamespace = 'core'::regnamespace
         UNION SELECT indexname FROM pg_indexes WHERE schemaname = 'core'`,
      );
      const have = new Set(names.rows.map((r: { n: string }) => r.n));
      for (const expected of [
        'chk_concessions_unit_price_nonnegative',
        'chk_bookings_status',
        'chk_bookings_owner',
        'chk_bookings_total_nonnegative',
        'uq_bookings_code',
        'uq_bookings_hold_group_idempotency',
        'uq_bookings_hold_group_active',
        'idx_bookings_user_created',
        'fk_bookings_user',
        'fk_bookings_hold_group',
        'chk_booking_seats_price_nonnegative',
        'uq_booking_seats_booking_seat',
        'idx_booking_seats_showtime_seat',
        'fk_booking_seats_booking',
        'fk_booking_seats_showtime',
        'fk_booking_seats_seat',
        'chk_booking_concessions_quantity_positive',
        'chk_booking_concessions_unit_price_nonnegative',
        'uq_booking_concessions_booking_concession',
        'fk_booking_concessions_booking',
        'fk_booking_concessions_concession',
        'chk_tickets_status',
        'uq_ticket_qr_hash',
        'uq_tickets_booking_seat',
        'uq_tickets_showtime_seat_live',
        'fk_tickets_booking',
        'fk_tickets_showtime',
        'fk_tickets_seat',
        'fk_seat_allocations_booking',
      ]) {
        expect(have, expected).toContain(expected);
      }

      const crossSchema = await knex.raw(
        `SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid
         WHERE c.contype = 'f' AND c.connamespace = 'core'::regnamespace
           AND t.relnamespace <> 'core'::regnamespace`,
      );
      expect(crossSchema.rows).toHaveLength(0);
    });

    it('creates a complete booking with seats, concessions, tickets and deferred seat_allocations.booking_id FK', async () => {
      await seedConcessions(knex);
      const concession = await knex('core.concessions').first();
      const holdGroupId = await newHoldGroup();
      const memberBooking = await insertBooking({
        user_id: userId,
        guest_token_hash: null,
        hold_group_id: holdGroupId,
      });

      await knex('core.booking_seats').insert([
        {
          booking_id: memberBooking,
          showtime_id: showtimeId,
          seat_id: seatAId,
          unit_price_vnd: 90000,
        },
        {
          booking_id: memberBooking,
          showtime_id: showtimeId,
          seat_id: seatBId,
          unit_price_vnd: 90000,
        },
      ]);
      await knex('core.booking_concessions').insert({
        booking_id: memberBooking,
        concession_id: concession.id,
        quantity: 2,
        unit_price_vnd: concession.unit_price_vnd,
      });
      await knex('core.tickets').insert({
        booking_id: memberBooking,
        showtime_id: showtimeId,
        seat_id: seatAId,
        qr_token_hash: `qr_${hex(8)}`,
      });
      await knex('core.seat_allocations').insert({
        showtime_id: showtimeId,
        auditorium_id: auditoriumId,
        seat_id: seatAId,
        booking_id: memberBooking,
        hold_group_id: holdGroupId,
        status: 'active',
      });

      const saved = await knex('core.bookings').where({ id: memberBooking }).first();
      expect(saved.status).toBe('pending_payment');
      expect(saved.user_id).toBe(userId);
      expect(saved.total_vnd).toBe('90000');
    });

    it('rejects invalid booking owner, status and negative total', async () => {
      const cases: Array<[string, Record<string, unknown>, string]> = [
        ['neither user nor guest token', { user_id: null, guest_token_hash: null }, 'chk_bookings_owner'],
        ['user and guest token', { user_id: 'USER', guest_token_hash: 'h' }, 'chk_bookings_owner'],
        ['unknown status', { status: 'paid' }, 'chk_bookings_status'],
        ['negative total', { total_vnd: -1 }, 'chk_bookings_total_nonnegative'],
      ];
      for (const [, overrides, constraint] of cases) {
        const data = { ...overrides };
        if (data.user_id === 'USER') {
          data.user_id = await newUser();
        }
        await expectPgError(insertBooking(data), '23514', constraint);
      }
    });

    it('enforces booking uniqueness rules and allows retry after terminal status', async () => {
      const code = `BK${hex(6).toUpperCase()}`;
      await insertBooking({ booking_code: code });
      await expectPgError(insertBooking({ booking_code: code }), '23505', 'uq_bookings_code');

      // Idempotency key is scoped to hold_group_id, not global.
      const holdA = await newHoldGroup();
      const holdB = await newHoldGroup();
      const firstId = await insertBooking({
        hold_group_id: holdA,
        idempotency_key: 'same_key',
        status: 'payment_failed',
      });
      await insertBooking({ hold_group_id: holdB, idempotency_key: 'same_key' });
      await expectPgError(
        insertBooking({ hold_group_id: holdA, idempotency_key: 'same_key' }),
        '23505',
        'uq_bookings_hold_group_idempotency',
      );
      expect(firstId).toBeTruthy();

      // Only one active booking per hold group; terminal statuses release the slot.
      const holdC = await newHoldGroup();
      const activeId = await insertBooking({ hold_group_id: holdC, status: 'pending_payment' });
      await expectPgError(
        insertBooking({ hold_group_id: holdC }),
        '23505',
        'uq_bookings_hold_group_active',
      );
      await knex('core.bookings').where({ id: activeId }).update({ status: 'expired' });
      const retryId = await insertBooking({ hold_group_id: holdC, status: 'confirmed' });
      expect(retryId).toBeTruthy();
    });

    it('enforces booking_seats price, uniqueness, FKs and showtime/auditorium consistency', async () => {
      const bookingId = await insertBooking();
      await knex('core.booking_seats').insert({
        booking_id: bookingId,
        showtime_id: showtimeId,
        seat_id: seatAId,
        unit_price_vnd: 0,
      });

      await expectPgError(
        knex('core.booking_seats').insert({
          booking_id: bookingId,
          showtime_id: showtimeId,
          seat_id: seatAId,
          unit_price_vnd: 90000,
        }),
        '23505',
        'uq_booking_seats_booking_seat',
      );
      await expectPgError(
        knex('core.booking_seats').insert({
          booking_id: bookingId,
          showtime_id: showtimeId,
          seat_id: seatBId,
          unit_price_vnd: -1,
        }),
        '23514',
        'chk_booking_seats_price_nonnegative',
      );
      await expectPgError(
        knex('core.booking_seats').insert({
          booking_id: randomUUID(),
          showtime_id: showtimeId,
          seat_id: seatBId,
          unit_price_vnd: 90000,
        }),
        '23503',
        'fk_booking_seats_booking',
      );

      // Showtime mismatch with booking's hold_group
      await expectPgError(
        knex('core.booking_seats').insert({
          booking_id: bookingId,
          showtime_id: otherShowtimeId,
          seat_id: otherAuditoriumSeatId,
          unit_price_vnd: 90000,
        }),
        '23514',
        'chk_booking_seat_showtime_matches_booking',
      );

      // Seat auditorium mismatch with showtime auditorium
      await expectPgError(
        knex('core.booking_seats').insert({
          booking_id: bookingId,
          showtime_id: showtimeId,
          seat_id: otherAuditoriumSeatId,
          unit_price_vnd: 90000,
        }),
        '23514',
        'chk_booking_seat_auditorium_matches_showtime',
      );
    });

    it('enforces concessions and booking_concessions constraints', async () => {
      await expectPgError(
        knex('core.concessions').insert({ name: 'Bad', unit_price_vnd: -1 }),
        '23514',
        'chk_concessions_unit_price_nonnegative',
      );

      const [item] = await knex('core.concessions')
        .insert({ name: 'Combo test', unit_price_vnd: 50000 })
        .returning('id');
      const bookingId = await insertBooking();

      await expectPgError(
        knex('core.booking_concessions').insert({
          booking_id: bookingId,
          concession_id: item.id,
          quantity: 0,
          unit_price_vnd: 50000,
        }),
        '23514',
        'chk_booking_concessions_quantity_positive',
      );
      await expectPgError(
        knex('core.booking_concessions').insert({
          booking_id: bookingId,
          concession_id: item.id,
          quantity: 1,
          unit_price_vnd: -1,
        }),
        '23514',
        'chk_booking_concessions_unit_price_nonnegative',
      );

      await knex('core.booking_concessions').insert({
        booking_id: bookingId,
        concession_id: item.id,
        quantity: 1,
        unit_price_vnd: 50000,
      });
      await expectPgError(
        knex('core.booking_concessions').insert({
          booking_id: bookingId,
          concession_id: item.id,
          quantity: 2,
          unit_price_vnd: 50000,
        }),
        '23505',
        'uq_booking_concessions_booking_concession',
      );
    });

    it('enforces ticket QR uniqueness, status, showtime/auditorium consistency and one live ticket per (showtime, seat)', async () => {
      const [showtime] = await knex('core.showtimes')
        .insert({
          movie_id: (await knex('core.movies').first()).id,
          cinema_id: cinemaId,
          auditorium_id: auditoriumId,
          starts_at: '2026-12-21T12:30:00Z',
          ends_at: '2026-12-21T14:30:00Z',
          format: '2D',
          state: 'on_sale',
        })
        .returning('id');
      const localShowtimeId = showtime.id as string;

      const bookingA = await insertBooking({
        hold_group_id: await newHoldGroup(localShowtimeId),
      });
      const bookingB = await insertBooking({
        hold_group_id: await newHoldGroup(localShowtimeId),
      });
      const qr = `qr_${hex(8)}`;

      const [ticketA] = await knex('core.tickets')
        .insert({
          booking_id: bookingA,
          showtime_id: localShowtimeId,
          seat_id: seatAId,
          qr_token_hash: qr,
        })
        .returning('id');

      await expectPgError(
        knex('core.tickets').insert({
          booking_id: bookingA,
          showtime_id: localShowtimeId,
          seat_id: seatBId,
          qr_token_hash: qr,
        }),
        '23505',
        'uq_ticket_qr_hash',
      );
      await expectPgError(
        knex('core.tickets').insert({
          booking_id: bookingA,
          showtime_id: localShowtimeId,
          seat_id: seatAId,
          qr_token_hash: `qr_${hex(8)}`,
        }),
        '23505',
        'uq_tickets_booking_seat',
      );
      await expectPgError(
        knex('core.tickets').insert({
          booking_id: bookingB,
          showtime_id: localShowtimeId,
          seat_id: seatAId,
          qr_token_hash: `qr_${hex(8)}`,
        }),
        '23505',
        'uq_tickets_showtime_seat_live',
      );
      await expectPgError(
        knex('core.tickets').insert({
          booking_id: bookingA,
          showtime_id: localShowtimeId,
          seat_id: seatBId,
          qr_token_hash: `qr_${hex(8)}`,
          status: 'revoked',
        }),
        '23514',
        'chk_tickets_status',
      );

      // Showtime mismatch with booking's hold_group
      await expectPgError(
        knex('core.tickets').insert({
          booking_id: bookingA,
          showtime_id: otherShowtimeId,
          seat_id: otherAuditoriumSeatId,
          qr_token_hash: `qr_${hex(8)}`,
        }),
        '23514',
        'chk_ticket_showtime_matches_booking',
      );

      // Seat auditorium mismatch with showtime auditorium
      await expectPgError(
        knex('core.tickets').insert({
          booking_id: bookingA,
          showtime_id: localShowtimeId,
          seat_id: otherAuditoriumSeatId,
          qr_token_hash: `qr_${hex(8)}`,
        }),
        '23514',
        'chk_ticket_auditorium_matches_showtime',
      );

      // Cancelling the original ticket frees the seat for a new booking.
      await knex('core.tickets').where({ id: ticketA.id }).update({ status: 'cancelled' });
      await knex('core.tickets').insert({
        booking_id: bookingB,
        showtime_id: localShowtimeId,
        seat_id: seatAId,
        qr_token_hash: `qr_${hex(8)}`,
      });
    });

    it('rejects a seat_allocation that points at a non-existent booking', async () => {
      await expectPgError(
        knex('core.seat_allocations').insert({
          showtime_id: showtimeId,
          auditorium_id: auditoriumId,
          seat_id: seatBId,
          booking_id: randomUUID(),
          hold_group_id: await newHoldGroup(),
        }),
        '23503',
        'fk_seat_allocations_booking',
      );
    });

    it('seeds the 5 Vietnamese concessions idempotently without deleting referenced rows', async () => {
      await knex('core.booking_concessions').del();
      await knex('core.concessions').del();
      await seedConcessions(knex);
      expect(await knex('core.concessions')).toHaveLength(5);

      // Reference a seeded concession from a booking, then re-seed: must not fail on FK.
      const seeded = await knex('core.concessions')
        .where({ id: '90000000-0000-4000-8000-000000000001' })
        .first();
      await knex('core.booking_concessions').insert({
        booking_id: await insertBooking(),
        concession_id: seeded.id,
        quantity: 1,
        unit_price_vnd: seeded.unit_price_vnd,
      });
      await seedConcessions(knex);
      expect(await knex('core.concessions')).toHaveLength(5);
    });

    it('rolls the 6 BO-01 migrations back and re-applies them cleanly', async () => {
      await knex('core.seat_allocations').del();
      for (let i = 0; i < 6; i += 1) {
        await knex.migrate.down();
      }
      const left = await knex.raw(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'core'
           AND table_name IN ('concessions','bookings','booking_seats','booking_concessions','tickets')`,
      );
      expect(left.rows).toHaveLength(0);
      const fk = await knex.raw(
        "SELECT 1 FROM pg_constraint WHERE conname = 'fk_seat_allocations_booking'",
      );
      expect(fk.rows).toHaveLength(0);

      await knex.migrate.latest();
      const applied = await knex('core.knex_migrations').where('name', 'like', '20261122170%');
      expect(applied).toHaveLength(6);
    }, 60_000);
  },
);
