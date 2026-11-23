import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory from 'knex';
import type { Knex } from 'knex';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Needs a PostgreSQL URL with CREATEDB (any database); the suite creates and drops its own database.
const adminUrl = process.env.BO01_TEST_DATABASE_URL;

const coreServiceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(coreServiceDir, 'db', 'migrations');
const seedsDir = path.join(coreServiceDir, 'db', 'seeds');

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

describe.skipIf(!adminUrl)('BO-01 core migrations (bookings, tickets, concessions)', () => {
  const dbName = `bo01_core_${hex()}`;
  let admin: pg.Client;
  let knex: Knex;

  // One cinema, auditorium and movie for the whole suite; showtimes are 3 days apart so the
  // SH-01 room-overlap exclusion never fires.
  let auditoriumId: string;
  let cinemaId: string;
  let movieId: string;
  let holdShowtimeId: string;
  let counter = 0;

  async function newShowtime(): Promise<string> {
    const startsAt = new Date(Date.UTC(2030, 0, 1 + 3 * counter++));
    const [row] = await knex('showtimes')
      .insert({
        movie_id: movieId,
        cinema_id: cinemaId,
        auditorium_id: auditoriumId,
        starts_at: startsAt,
        ends_at: new Date(startsAt.getTime() + 2 * 3600_000),
        format: '2D',
      })
      .returning('id');
    return row.id as string;
  }

  async function newSeat(): Promise<string> {
    const [row] = await knex('seats')
      .insert({ auditorium_id: auditoriumId, row_label: 'A', seat_number: counter++ })
      .returning('id');
    return row.id as string;
  }

  async function newHold(): Promise<string> {
    const [row] = await knex('seat_hold_groups')
      .insert({
        showtime_id: holdShowtimeId,
        owner_ref: `owner-${hex()}`,
        expires_at: knex.raw("now() + interval '15 minutes'"),
      })
      .returning('id');
    return row.id as string;
  }

  // Books a seat for a showtime on a booking (a ticket requires this row, fk_tickets_booking_seat).
  async function bookSeat(booking: string, showtime: string, seat: string): Promise<void> {
    await knex('booking_seats').insert({
      booking_id: booking,
      showtime_id: showtime,
      seat_id: seat,
      unit_price_vnd: 1000,
    });
  }

  // A booking with one booked seat; returns the ticket row that matches it.
  async function bookedTicket(status = 'valid') {
    const row = {
      booking_id: await insertBooking(),
      showtime_id: await newShowtime(),
      seat_id: await newSeat(),
      qr_token_hash: hex(16),
      status,
    };
    await bookSeat(row.booking_id, row.showtime_id, row.seat_id);
    return row;
  }

  async function newUser(): Promise<number> {
    const [role] = await knex('roles')
      .insert({ name: `r_${hex()}` })
      .returning('id');
    const [user] = await knex('users')
      .insert({
        email: `${hex()}@example.test`,
        password_hash: 'x',
        full_name: 'Test User',
        role_id: role.id,
      })
      .returning('id');
    return user.id as number;
  }

  async function insertBooking(overrides: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    await knex('bookings').insert({
      id,
      booking_code: hex(6).toUpperCase(),
      contact_name: 'Nguyễn Văn A',
      contact_email: 'a@example.test',
      guest_token_hash: hex(16),
      hold_group_id: await newHold(),
      idempotency_key: hex(8),
      total_vnd: 0,
      expires_at: knex.raw("now() + interval '15 minutes'"),
      ...overrides,
    });
    return id;
  }

  beforeAll(async () => {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    admin = client;
    await admin.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);

    knex = knexFactory({
      client: 'pg',
      connection: urlForDatabase(adminUrl ?? '', dbName),
      searchPath: ['core'],
      pool: { min: 1, max: 5 },
      migrations: {
        directory: migrationsDir,
        schemaName: 'core',
        tableName: 'knex_migrations',
        extension: 'ts',
        loadExtensions: ['.ts'],
      },
      seeds: { directory: seedsDir, extension: 'ts', loadExtensions: ['.ts'] },
    });

    // Run the init SQL on a plain connection, as docker does: through knex the extensions would
    // land in schema core instead of public.
    const init = new pg.Client({ connectionString: urlForDatabase(adminUrl ?? '', dbName) });
    await init.connect();
    await init.query(readFileSync(initSql, 'utf8'));
    await init.end();

    await knex.migrate.latest();

    const [movie] = await knex('movies')
      .insert({ title: 'Test Movie', duration_min: 120 })
      .returning('id');
    const [cinema] = await knex('cinemas')
      .insert({ name: 'Test Cinema', address: '1 Test St', city: 'HCMC' })
      .returning('id');
    const [auditorium] = await knex('auditoriums')
      .insert({ cinema_id: cinema.id, name: 'Room 1' })
      .returning('id');
    movieId = movie.id;
    cinemaId = cinema.id;
    auditoriumId = auditorium.id;
    holdShowtimeId = await newShowtime();
  }, 60_000);

  afterAll(async () => {
    await knex?.destroy();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30_000);

  it('applies the 7 BO-01 migrations with integer-VND columns and named constraints', async () => {
    const applied = await knex('knex_migrations')
      .where('name', 'like', '20261122170%')
      .orWhere('name', 'like', '20261123100000%');
    expect(applied).toHaveLength(7);

    const money = await knex.raw(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'core' AND column_name IN ('unit_price_vnd', 'total_vnd')
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
      'chk_bookings_status',
      'chk_bookings_total_nonnegative',
      'chk_bookings_owner',
      'chk_bookings_confirmed_at',
      'chk_bookings_cancelled_at',
      'chk_booking_seats_unit_price_nonnegative',
      'chk_booking_concessions_quantity_positive',
      'chk_booking_concessions_unit_price_nonnegative',
      'chk_concessions_unit_price_nonnegative',
      'chk_tickets_status',
      'uq_bookings_booking_code',
      'uq_bookings_hold_idempotency',
      'uq_bookings_hold_group_active',
      'uq_booking_seats_booking_seat',
      'uq_booking_seats_booking_showtime_seat',
      'uq_booking_concessions_booking_concession',
      'uq_ticket_qr_hash',
      'uq_tickets_booking_seat',
      'uq_tickets_showtime_seat_live',
      'idx_bookings_user_created',
      'idx_bookings_pending_expires',
      'idx_booking_seats_showtime_seat',
      'idx_booking_seats_seat_id',
      'idx_tickets_seat_id',
      'idx_tickets_showtime_id',
      'idx_booking_concessions_concession_id',
      'fk_bookings_user',
      'fk_bookings_hold_group',
      'fk_booking_seats_booking',
      'fk_booking_seats_showtime',
      'fk_booking_seats_seat',
      'fk_booking_concessions_booking',
      'fk_booking_concessions_concession',
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

  it('stores a full guest and a member booking flow with bigint money', async () => {
    const guestBooking = await insertBooking({ total_vnd: '9007199254740993' });
    const row = await knex('bookings').where({ id: guestBooking }).first();
    expect(row.status).toBe('pending_payment');
    expect(row.total_vnd).toBe('9007199254740993');

    const userId = await newUser();
    const memberBooking = await insertBooking({ user_id: userId, guest_token_hash: null });

    const [showtime, seat] = [await newShowtime(), await newSeat()];
    const [concession] = await knex('concessions')
      .insert({ name: 'Bắp', unit_price_vnd: 45000 })
      .returning('id');
    await bookSeat(memberBooking, showtime, seat);
    await knex('booking_concessions').insert({
      booking_id: memberBooking,
      concession_id: concession.id,
      quantity: 2,
      unit_price_vnd: 45000,
    });
    await knex('bookings')
      .where({ id: memberBooking })
      .update({ status: 'confirmed', confirmed_at: knex.fn.now() });
    await knex('tickets').insert({
      booking_id: memberBooking,
      showtime_id: showtime,
      seat_id: seat,
      qr_token_hash: hex(16),
    });
    const ticket = await knex('tickets').where({ booking_id: memberBooking }).first();
    expect(ticket.status).toBe('valid');
  });

  it.each([
    ['unknown status', { status: 'bogus' }, 'chk_bookings_status'],
    ['negative total', { total_vnd: -1 }, 'chk_bookings_total_nonnegative'],
    ['user and guest token', { user_id: 'USER', guest_token_hash: 'h' }, 'chk_bookings_owner'],
    ['neither user nor token', { guest_token_hash: null }, 'chk_bookings_owner'],
    ['confirmed without confirmed_at', { status: 'confirmed' }, 'chk_bookings_confirmed_at'],
    ['cancelled without cancelled_at', { status: 'cancelled' }, 'chk_bookings_cancelled_at'],
  ])('rejects booking: %s', async (_label, overrides, constraint) => {
    const data: Record<string, unknown> = { ...overrides };
    if (data.user_id === 'USER') {
      data.user_id = await newUser();
    }
    await expectPgError(insertBooking(data), '23514', constraint);
  });

  it.each([
    ['pending_payment', {}],
    ['confirmed', { confirmed_at: new Date() }],
    ['cancellation_pending', {}],
  ])('rejects a second booking on a hold while the first is %s', async (status, extra) => {
    const hold = await newHold();
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
    const hold = await newHold();
    await insertBooking({ hold_group_id: hold, status, ...extra });
    await insertBooking({ hold_group_id: hold });
  });

  it('enforces booking_code and hold-scoped idempotency', async () => {
    const code = hex(6).toUpperCase();
    await insertBooking({ booking_code: code });
    await expectPgError(insertBooking({ booking_code: code }), '23505', 'uq_bookings_booking_code');

    // Same key under a different hold is fine; under the same hold it is rejected.
    const holdA = await newHold();
    const holdB = await newHold();
    const first = await insertBooking({ hold_group_id: holdA, idempotency_key: 'same-key' });
    await insertBooking({ hold_group_id: holdB, idempotency_key: 'same-key' });

    await knex('bookings').where({ id: first }).update({ status: 'expired' });
    // The first booking is no longer active, so only the idempotency index can fire.
    await expectPgError(
      insertBooking({ hold_group_id: holdA, idempotency_key: 'same-key' }),
      '23505',
      'uq_bookings_hold_idempotency',
    );
  });

  it('enforces booking_seats, booking_concessions and concessions rules', async () => {
    const booking = await insertBooking();
    const row = {
      booking_id: booking,
      showtime_id: await newShowtime(),
      seat_id: await newSeat(),
      unit_price_vnd: 1000,
    };
    await knex('booking_seats').insert(row);
    // Zero is a legal price.
    await knex('booking_seats').insert({ ...row, seat_id: await newSeat(), unit_price_vnd: 0 });
    // A different showtime keeps the (booking, showtime, seat) unique constraint out of play.
    await expectPgError(
      knex('booking_seats').insert({ ...row, showtime_id: await newShowtime() }),
      '23505',
      'uq_booking_seats_booking_seat',
    );
    await expectPgError(
      knex('booking_seats').insert({ ...row, seat_id: await newSeat(), unit_price_vnd: -1 }),
      '23514',
      'chk_booking_seats_unit_price_nonnegative',
    );
    await expectPgError(
      knex('booking_seats').insert({ ...row, seat_id: randomUUID() }),
      '23503',
      'fk_booking_seats_seat',
    );

    await expectPgError(
      knex('concessions').insert({ name: 'Bad', unit_price_vnd: -1 }),
      '23514',
      'chk_concessions_unit_price_nonnegative',
    );
    const [concession, freeConcession] = await knex('concessions')
      .insert([
        { name: 'Nước', unit_price_vnd: 20000 },
        { name: 'Quà tặng', unit_price_vnd: 0 },
      ])
      .returning(['id', 'is_available']);
    expect(concession.is_available).toBe(true);
    const line = {
      booking_id: booking,
      concession_id: concession.id,
      quantity: 1,
      unit_price_vnd: 20000,
    };
    await expectPgError(
      knex('booking_concessions').insert({ ...line, quantity: 0 }),
      '23514',
      'chk_booking_concessions_quantity_positive',
    );
    await expectPgError(
      knex('booking_concessions').insert({ ...line, unit_price_vnd: -1 }),
      '23514',
      'chk_booking_concessions_unit_price_nonnegative',
    );
    await knex('booking_concessions').insert(line);
    // A booking may hold several concessions.
    await knex('booking_concessions').insert({
      ...line,
      concession_id: freeConcession.id,
      unit_price_vnd: 0,
    });
    await expectPgError(
      knex('booking_concessions').insert(line),
      '23505',
      'uq_booking_concessions_booking_concession',
    );
  });

  it.each(['valid', 'used', 'cancelled'])('accepts ticket status %s', async (status) => {
    await knex('tickets').insert(await bookedTicket(status));
  });

  it('enforces ticket rules: unique qr hash, booking+seat, live seat uniqueness, status', async () => {
    const ticket = await bookedTicket();
    const [first] = await knex('tickets').insert(ticket).returning('id');

    // Same qr hash on another booked seat of the same booking: only the qr index can fire.
    const otherSeat = await newSeat();
    await bookSeat(ticket.booking_id, ticket.showtime_id, otherSeat);
    await expectPgError(
      knex('tickets').insert({ ...ticket, seat_id: otherSeat }),
      '23505',
      'uq_ticket_qr_hash',
    );
    // A booking may hold several tickets for the same showtime.
    await knex('tickets').insert({ ...ticket, seat_id: otherSeat, qr_token_hash: hex(16) });

    // Same booking+seat again: a cancelled duplicate is outside the live-seat index.
    await expectPgError(
      knex('tickets').insert({ ...ticket, qr_token_hash: hex(16), status: 'cancelled' }),
      '23505',
      'uq_tickets_booking_seat',
    );

    // Another booking holding the same showtime seat cannot get a live ticket...
    const other = await insertBooking();
    await bookSeat(other, ticket.showtime_id, ticket.seat_id);
    const reissue = { ...ticket, booking_id: other, qr_token_hash: hex(16) };
    await expectPgError(knex('tickets').insert(reissue), '23505', 'uq_tickets_showtime_seat_live');
    // ...not even after the first one was used...
    await knex('tickets').where({ id: first.id }).update({ status: 'used' });
    await expectPgError(knex('tickets').insert(reissue), '23505', 'uq_tickets_showtime_seat_live');
    // ...until it is cancelled.
    await knex('tickets').where({ id: first.id }).update({ status: 'cancelled' });
    await knex('tickets').insert(reissue);

    await expectPgError(
      knex('tickets').insert(await bookedTicket('bogus')),
      '23514',
      'chk_tickets_status',
    );
  });

  it('requires a booked seat for the same showtime before issuing a ticket', async () => {
    // No booking_seats row for this (booking, showtime, seat); every other FK is valid.
    const unbooked = {
      booking_id: await insertBooking(),
      showtime_id: await newShowtime(),
      seat_id: await newSeat(),
      qr_token_hash: hex(16),
    };
    await expectPgError(knex('tickets').insert(unbooked), '23503', 'fk_tickets_booking_seat');

    // Seat booked for another showtime of the same booking: still not this showtime.
    const booked = await bookedTicket();
    await expectPgError(
      knex('tickets').insert({ ...booked, showtime_id: await newShowtime() }),
      '23503',
      'fk_tickets_booking_seat',
    );

    // A booked seat cannot be removed while its ticket exists.
    await knex('tickets').insert(booked);
    await expectPgError(
      knex('booking_seats').where({ booking_id: booked.booking_id }).del(),
      '23503',
      'fk_tickets_booking_seat',
    );
  });

  it('restricts deleting a booking referenced by seat_allocations', async () => {
    const booking = await insertBooking();
    const allocation = {
      showtime_id: await newShowtime(),
      auditorium_id: auditoriumId,
      seat_id: await newSeat(),
    };
    await expectPgError(
      knex('seat_allocations').insert({ ...allocation, booking_id: randomUUID() }),
      '23503',
      'fk_seat_allocations_booking',
    );
    await knex('seat_allocations').insert({ ...allocation, booking_id: booking });
    await expectPgError(
      knex('bookings').where({ id: booking }).del(),
      '23503',
      'fk_seat_allocations_booking',
    );
  });

  it('seeds concessions idempotently', async () => {
    await knex.seed.run({ specific: '05_concessions.ts' });
    await knex('concessions')
      .where({ id: '90000000-0000-4000-8000-000000000001' })
      .update({ unit_price_vnd: 1 });
    await knex.seed.run({ specific: '05_concessions.ts' });

    const rows = await knex('concessions').whereRaw("id::text LIKE '90000000-%'").orderBy('id');
    expect(rows).toHaveLength(5);
    expect(rows[0].name).toBe('Bắp rang bơ (vừa)');
    expect(rows[0].unit_price_vnd).toBe('45000');
  });

  it('reverts and re-applies the harden migration on its own', async () => {
    const present = async () => {
      const result = await knex.raw(
        `SELECT conname AS n FROM pg_constraint WHERE connamespace = 'core'::regnamespace
         UNION SELECT indexname FROM pg_indexes WHERE schemaname = 'core'`,
      );
      const have = new Set(result.rows.map((r: { n: string }) => r.n));
      return [
        'uq_booking_seats_booking_showtime_seat',
        'fk_tickets_booking_seat',
        'idx_booking_seats_seat_id',
        'idx_tickets_seat_id',
        'idx_tickets_showtime_id',
        'idx_booking_concessions_concession_id',
      ].filter((name) => have.has(name));
    };
    await knex.migrate.down({ name: hardenMigration });
    expect(await present()).toEqual([]);
    await knex.migrate.up({ name: hardenMigration });
    expect(await present()).toHaveLength(6);
  }, 60_000);

  // Must stay last: it drops the fixtures created in beforeAll.
  it('rolls everything back and re-applies cleanly', async () => {
    await knex.migrate.rollback(undefined, true);
    const left = await knex.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'core' AND table_name IN
         ('bookings','booking_seats','booking_concessions','concessions','tickets')`,
    );
    expect(left.rows).toHaveLength(0);

    await knex.migrate.latest();
    const applied = await knex('knex_migrations')
      .where('name', 'like', '20261122170%')
      .orWhere('name', 'like', '20261123100000%');
    expect(applied).toHaveLength(7);
  }, 60_000);
});
