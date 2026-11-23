import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory from 'knex';
import type { Knex } from 'knex';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed as seedConcessions } from '../db/seeds/05_concessions.js';
import { seed as seedRoles } from '../db/seeds/00_roles.js';
import { seed as seedCatalog } from '../db/seeds/01_catalog.js';

// Needs a PostgreSQL URL with CREATEDB (any database); the suite creates and drops its own database.
const adminUrl =
  process.env.BO01_TEST_DATABASE_URL ??
  process.env.SH01_TEST_DATABASE_URL;

const coreServiceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(coreServiceDir, 'db', 'migrations');
const hardenMigration = '20261123100000_harden_booking_integrity.ts';
const initSql = path.resolve(
  coreServiceDir,
  '../../infrastructure/docker/postgres/init/01-init-schemas.sql',
);

interface PgErrorShape {
  code?: string;
  constraint?: string;
}

async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  constraint: string,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    const pgErr = error as PgErrorShape;
    expect(pgErr.code).toBe(code);
    expect(pgErr.constraint).toBe(constraint);
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
    let seatNumberCounter = 100;

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

    async function newSeat(targetAuditoriumId = auditoriumId): Promise<string> {
      const [row] = await knex('core.seats')
        .insert({
          auditorium_id: targetAuditoriumId,
          row_label: 'Z',
          seat_number: seatNumberCounter++,
          seat_type: 'standard',
          couple_pair_id: null,
        })
        .returning('id');
      return row.id as string;
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

    // Books a seat for a showtime on a booking (tickets require this row via fk_tickets_booking_seat).
    async function bookSeat(
      bookingId: string,
      targetShowtimeId: string,
      seatId: string,
      unitPriceVnd = 90000,
    ): Promise<void> {
      await knex('core.booking_seats').insert({
        booking_id: bookingId,
        showtime_id: targetShowtimeId,
        seat_id: seatId,
        unit_price_vnd: unitPriceVnd,
      });
    }

    // Creates a booking + booked seat in showtimeId and returns the matching ticket row.
    async function bookedTicket(status = 'valid') {
      const bookingId = await insertBooking();
      const seatId = await newSeat();
      await bookSeat(bookingId, showtimeId, seatId);
      return {
        booking_id: bookingId,
        showtime_id: showtimeId,
        seat_id: seatId,
        qr_token_hash: `qr_${hex(12)}`,
        status,
      };
    }

    beforeAll(async () => {
      const client = new pg.Client({ connectionString: adminUrl });
      await client.connect();
      admin = client;
      await admin.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);

      const dbUrl = urlForDatabase(adminUrl ?? '', dbName);

      // Run init SQL on a plain connection so extensions land in public schema.
      const initClient = new pg.Client({ connectionString: dbUrl });
      await initClient.connect();
      await initClient.query(readFileSync(initSql, 'utf8'));
      await initClient.end();

      knex = knexFactory({
        client: 'pg',
        connection: dbUrl,
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

    it('applies all 23 core migrations (including 7 BO-01 migrations) with bigint money, named constraints, FK indexes and no cross-schema FK', async () => {
      const allApplied = await knex('core.knex_migrations');
      expect(allApplied).toHaveLength(23);

      const bo01Applied = await knex('core.knex_migrations')
        .where('name', 'like', '20261122170%')
        .orWhere('name', 'like', '20261123100000%');
      expect(bo01Applied).toHaveLength(7);

      const money = await knex.raw(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'core' AND column_name IN ('total_vnd','unit_price_vnd')
           AND table_name IN ('concessions','bookings','booking_seats','booking_concessions')`,
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
        'uq_booking_seats_booking_showtime_seat',
        'idx_booking_seats_showtime_seat',
        'idx_booking_seats_seat_id',
        'fk_booking_seats_booking',
        'fk_booking_seats_showtime',
        'fk_booking_seats_seat',
        'chk_booking_concessions_quantity_positive',
        'chk_booking_concessions_unit_price_nonnegative',
        'uq_booking_concessions_booking_concession',
        'idx_booking_concessions_concession_id',
        'fk_booking_concessions_booking',
        'fk_booking_concessions_concession',
        'chk_tickets_status',
        'uq_ticket_qr_hash',
        'uq_tickets_booking_seat',
        'uq_tickets_showtime_seat_live',
        'idx_tickets_seat_id',
        'idx_tickets_showtime_id',
        'fk_tickets_booking',
        'fk_tickets_showtime',
        'fk_tickets_seat',
        'fk_tickets_booking_seat',
        'fk_seat_allocations_booking',
      ]) {
        expect(have, expected).toContain(expected);
      }

      const indexes = await knex.raw(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'core' AND indexname IN
           ('idx_booking_seats_seat_id','idx_tickets_seat_id','idx_tickets_showtime_id',
            'idx_booking_concessions_concession_id') ORDER BY indexname`,
      );
      expect(
        indexes.rows.map((r: { indexdef: string }) => r.indexdef.replace(/^.* ON /, '')),
      ).toEqual([
        'core.booking_concessions USING btree (concession_id)',
        'core.booking_seats USING btree (seat_id)',
        'core.tickets USING btree (seat_id)',
        'core.tickets USING btree (showtime_id)',
      ]);

      const crossSchema = await knex.raw(
        `SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid
         WHERE c.contype = 'f' AND c.connamespace = 'core'::regnamespace
           AND t.relnamespace <> 'core'::regnamespace`,
      );
      expect(crossSchema.rows).toHaveLength(0);
    });

    it('allows NULL only in the optional columns', async () => {
      const nullable = await knex.raw(
        `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
         WHERE table_schema = 'core' AND is_nullable = 'YES' AND table_name IN
           ('bookings','booking_seats','booking_concessions','concessions','tickets') ORDER BY 1`,
      );
      expect(nullable.rows.map((r: { c: string }) => r.c)).toEqual([
        'bookings.cancelled_at',
        'bookings.confirmed_at',
        'bookings.contact_phone',
        'bookings.guest_token_hash',
        'bookings.payment_id',
        'bookings.user_id',
      ]);
    });

    it('makes every BO-01 foreign key ON DELETE RESTRICT', async () => {
      const fks = await knex.raw(
        `SELECT conname, confdeltype FROM pg_constraint
         WHERE contype = 'f' AND (conname = 'fk_seat_allocations_booking' OR conrelid IN (
           'core.bookings'::regclass, 'core.booking_seats'::regclass,
           'core.booking_concessions'::regclass, 'core.concessions'::regclass,
           'core.tickets'::regclass))`,
      );
      expect(fks.rows.length).toBeGreaterThan(0);
      for (const fk of fks.rows) {
        expect(fk.confdeltype, fk.conname).toBe('r');
      }
    });

    it('creates complete guest and member bookings with bigint money, seats, concessions, tickets and seat_allocations', async () => {
      const guestBooking = await insertBooking({ total_vnd: '9007199254740993' });
      const guestSaved = await knex('core.bookings').where({ id: guestBooking }).first();
      expect(guestSaved.status).toBe('pending_payment');
      expect(guestSaved.total_vnd).toBe('9007199254740993');

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
      await knex('core.bookings')
        .where({ id: memberBooking })
        .update({ status: 'confirmed', confirmed_at: knex.fn.now() });
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
      expect(saved.status).toBe('confirmed');
      expect(saved.user_id).toBe(userId);
      expect(saved.total_vnd).toBe('90000');

      const ticket = await knex('core.tickets').where({ booking_id: memberBooking }).first();
      expect(ticket.status).toBe('valid');
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

    it.each([
      ['pending_payment', {}],
      ['confirmed', { confirmed_at: new Date() }],
      ['cancellation_pending', {}],
    ])('rejects a second booking on a hold while the first is %s', async (status, extra) => {
      const hold = await newHoldGroup();
      await insertBooking({ hold_group_id: hold, status, ...extra });
      await expectPgError(
        insertBooking({ hold_group_id: hold }),
        '23505',
        'uq_bookings_hold_group_active',
      );
    });

    it.each([
      ['payment_failed', {}],
      ['expired', {}],
      ['cancelled', { cancelled_at: new Date() }],
    ])('allows a new booking on a hold once the first is %s', async (status, extra) => {
      const hold = await newHoldGroup();
      await insertBooking({ hold_group_id: hold, status, ...extra });
      const retryId = await insertBooking({ hold_group_id: hold });
      expect(retryId).toBeTruthy();
    });

    it('enforces booking uniqueness rules and hold-scoped idempotency', async () => {
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
    });

    it('enforces booking_seats price, uniqueness, FKs and showtime/auditorium consistency', async () => {
      const bookingId = await insertBooking();
      await bookSeat(bookingId, showtimeId, seatAId, 0);

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
      await expectPgError(
        knex('core.booking_seats').insert({
          booking_id: bookingId,
          showtime_id: showtimeId,
          seat_id: randomUUID(),
          unit_price_vnd: 90000,
        }),
        '23503',
        'fk_booking_seats_seat',
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

      const [item, freeItem] = await knex('core.concessions')
        .insert([
          { name: 'Combo test', unit_price_vnd: 50000 },
          { name: 'Quà tặng', unit_price_vnd: 0 },
        ])
        .returning(['id', 'is_available']);
      expect(item.is_available).toBe(true);
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
      // A booking may hold several concessions (including zero-price promotional items).
      await knex('core.booking_concessions').insert({
        booking_id: bookingId,
        concession_id: freeItem.id,
        quantity: 1,
        unit_price_vnd: 0,
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

    it.each(['valid', 'used', 'cancelled'])('accepts ticket status %s', async (status) => {
      await knex('core.tickets').insert(await bookedTicket(status));
    });

    it('enforces ticket QR uniqueness, booking+seat, status, showtime/auditorium consistency and one live ticket per (showtime, seat)', async () => {
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
      await bookSeat(bookingA, localShowtimeId, seatAId);
      await bookSeat(bookingA, localShowtimeId, seatBId);
      await bookSeat(bookingB, localShowtimeId, seatAId);

      const qr = `qr_${hex(8)}`;
      const [ticketA] = await knex('core.tickets')
        .insert({
          booking_id: bookingA,
          showtime_id: localShowtimeId,
          seat_id: seatAId,
          qr_token_hash: qr,
        })
        .returning('id');

      // Same QR hash on another booked seat of the same booking: uq_ticket_qr_hash fires.
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
      // A booking may hold several tickets for the same showtime.
      await knex('core.tickets').insert({
        booking_id: bookingA,
        showtime_id: localShowtimeId,
        seat_id: seatBId,
        qr_token_hash: `qr_${hex(8)}`,
      });

      // Same booking+seat again (even cancelled) hits uq_tickets_booking_seat.
      await expectPgError(
        knex('core.tickets').insert({
          booking_id: bookingA,
          showtime_id: localShowtimeId,
          seat_id: seatAId,
          qr_token_hash: `qr_${hex(8)}`,
          status: 'cancelled',
        }),
        '23505',
        'uq_tickets_booking_seat',
      );

      // Another booking cannot hold a live ticket while valid or used...
      const reissue = {
        booking_id: bookingB,
        showtime_id: localShowtimeId,
        seat_id: seatAId,
        qr_token_hash: `qr_${hex(8)}`,
      };
      await expectPgError(knex('core.tickets').insert(reissue), '23505', 'uq_tickets_showtime_seat_live');
      await knex('core.tickets').where({ id: ticketA.id }).update({ status: 'used' });
      await expectPgError(knex('core.tickets').insert(reissue), '23505', 'uq_tickets_showtime_seat_live');

      await expectPgError(
        knex('core.tickets').insert(await bookedTicket('revoked')),
        '23514',
        'chk_tickets_status',
      );

      // Showtime mismatch with booking's hold_group (consistency trigger fires before FK)
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

      // Seat auditorium mismatch with showtime auditorium (consistency trigger fires before FK)
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

      // Cancelling the original ticket frees the seat for bookingB.
      await knex('core.tickets').where({ id: ticketA.id }).update({ status: 'cancelled' });
      await knex('core.tickets').insert(reissue);
    });

    it('requires a booked seat for the same booking and showtime before issuing a ticket (fk_tickets_booking_seat)', async () => {
      // No booking_seats row for this (booking, showtime, seat); every single-column FK and trigger passes.
      const unbookedBooking = await insertBooking();
      const unbookedSeat = await newSeat();
      await expectPgError(
        knex('core.tickets').insert({
          booking_id: unbookedBooking,
          showtime_id: showtimeId,
          seat_id: unbookedSeat,
          qr_token_hash: `qr_${hex(12)}`,
        }),
        '23503',
        'fk_tickets_booking_seat',
      );

      // Seat booked by bookingB on showtimeId: bookingA cannot issue a ticket for it.
      const bookingA = await insertBooking();
      const bookingB = await insertBooking();
      const sharedSeat = await newSeat();
      await bookSeat(bookingB, showtimeId, sharedSeat);
      await expectPgError(
        knex('core.tickets').insert({
          booking_id: bookingA,
          showtime_id: showtimeId,
          seat_id: sharedSeat,
          qr_token_hash: `qr_${hex(12)}`,
        }),
        '23503',
        'fk_tickets_booking_seat',
      );

      // A booked seat cannot be removed while its ticket exists.
      const booked = await bookedTicket();
      await knex('core.tickets').insert(booked);
      await expectPgError(
        knex('core.booking_seats').where({ booking_id: booked.booking_id }).del(),
        '23503',
        'fk_tickets_booking_seat',
      );
    });

    it('restricts deleting a booking referenced by seat_allocations', async () => {
      const booking = await insertBooking();
      const seat = await newSeat();
      await expectPgError(
        knex('core.seat_allocations').insert({
          showtime_id: showtimeId,
          auditorium_id: auditoriumId,
          seat_id: seat,
          booking_id: randomUUID(),
          hold_group_id: await newHoldGroup(),
        }),
        '23503',
        'fk_seat_allocations_booking',
      );
      await knex('core.seat_allocations').insert({
        showtime_id: showtimeId,
        auditorium_id: auditoriumId,
        seat_id: seat,
        booking_id: booking,
        hold_group_id: await newHoldGroup(),
      });
      await expectPgError(
        knex('core.bookings').where({ id: booking }).del(),
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

    it('reverts and re-applies the harden migration on its own without dropping ticket indexes from 20261122170400', async () => {
      const queryObjects = async (namesToCheck: string[]) => {
        const result = await knex.raw(
          `SELECT conname AS n FROM pg_constraint WHERE connamespace = 'core'::regnamespace
           UNION SELECT indexname FROM pg_indexes WHERE schemaname = 'core'`,
        );
        const have = new Set(result.rows.map((r: { n: string }) => r.n));
        return namesToCheck.filter((name) => have.has(name));
      };

      const hardenOwned = [
        'uq_booking_seats_booking_showtime_seat',
        'fk_tickets_booking_seat',
        'idx_booking_seats_seat_id',
        'idx_booking_concessions_concession_id',
      ];
      const ticketIndexesOwnedBy170400 = ['idx_tickets_seat_id', 'idx_tickets_showtime_id'];

      await knex.migrate.down({ name: hardenMigration });
      expect(await queryObjects(hardenOwned)).toEqual([]);
      expect(await queryObjects(ticketIndexesOwnedBy170400)).toEqual(ticketIndexesOwnedBy170400);

      await knex.migrate.up({ name: hardenMigration });
      expect(await queryObjects(hardenOwned)).toHaveLength(4);
      expect(await queryObjects(ticketIndexesOwnedBy170400)).toEqual(ticketIndexesOwnedBy170400);
    }, 60_000);

    it('rolls the 7 BO-01 migrations back and re-applies them cleanly', async () => {
      await knex('core.seat_allocations').del();
      for (let i = 0; i < 7; i += 1) {
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
      const allApplied = await knex('core.knex_migrations');
      expect(allApplied).toHaveLength(23);
      const applied = await knex('core.knex_migrations')
        .where('name', 'like', '20261122170%')
        .orWhere('name', 'like', '20261123100000%');
      expect(applied).toHaveLength(7);
    }, 60_000);
  },
);
