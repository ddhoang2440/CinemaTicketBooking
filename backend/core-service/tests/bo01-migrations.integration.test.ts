import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory from 'knex';
import type { Knex } from 'knex';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Needs a PostgreSQL superuser URL (any database); the suite creates and drops its own database.
const adminUrl = process.env.BO01_TEST_DATABASE_URL;

const coreServiceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(coreServiceDir, 'db', 'migrations');
const seedsDir = path.join(coreServiceDir, 'db', 'seeds');

// BO-01 FKs point at CA-01 (seats) and SH-01 (showtimes, seat_hold_groups, seat_allocations).
// Until those migrations are merged, minimal provisional stubs are created. All-or-nothing:
// once both upstream sets exist, nothing is stubbed and only the migrate/rollback checks run.
const migrationFiles = readdirSync(migrationsDir);
const hasTv2 = migrationFiles.some((f) => f.endsWith('_create_seats_table.ts'));
const hasTv3 = migrationFiles.some((f) => f.endsWith('_create_seat_allocations_table.ts'));
if (hasTv2 !== hasTv3) {
  throw new Error('BO-01 tests need both CA-01 and SH-01 migrations, or neither');
}
const stubbed = !hasTv2 && !hasTv3;

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

describe.skipIf(!adminUrl)('BO-01 core migrations (bookings, tickets, concessions)', () => {
  const dbName = `bo01_core_${hex()}`;
  let admin: pg.Client;
  let knex: Knex;

  async function newHold(): Promise<string> {
    const id = randomUUID();
    await knex('seat_hold_groups').insert({ id });
    return id;
  }

  async function newSeat(): Promise<string> {
    const id = randomUUID();
    await knex('seats').insert({ id });
    return id;
  }

  async function newShowtime(): Promise<string> {
    const id = randomUUID();
    await knex('showtimes').insert({ id });
    return id;
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

    await knex.raw('CREATE SCHEMA IF NOT EXISTS core');
    if (stubbed) {
      await knex.raw('CREATE TABLE core.seats (id uuid PRIMARY KEY)');
      await knex.raw('CREATE TABLE core.showtimes (id uuid PRIMARY KEY)');
      await knex.raw('CREATE TABLE core.seat_hold_groups (id uuid PRIMARY KEY)');
      await knex.raw(
        'CREATE TABLE core.seat_allocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL)',
      );
    }
    await knex.migrate.latest();
  }, 60_000);

  afterAll(async () => {
    await knex?.destroy();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30_000);

  it('applies the 6 BO-01 migrations with integer-VND columns and named constraints', async () => {
    const applied = await knex('knex_migrations').where('name', 'like', '20261122170%');
    expect(applied).toHaveLength(6);

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
      'uq_booking_concessions_booking_concession',
      'uq_ticket_qr_hash',
      'uq_tickets_booking_seat',
      'uq_tickets_showtime_seat_live',
      'idx_bookings_user_created',
      'idx_bookings_pending_expires',
      'idx_booking_seats_showtime_seat',
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
      'fk_seat_allocations_booking',
    ]) {
      expect(have, expected).toContain(expected);
    }
  });

  describe.skipIf(!stubbed)('with provisional upstream tables', () => {
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
      await knex('booking_seats').insert({
        booking_id: memberBooking,
        showtime_id: showtime,
        seat_id: seat,
        unit_price_vnd: 90000,
      });
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

    it('enforces booking_code, hold-scoped idempotency and one active booking per hold', async () => {
      const code = hex(6).toUpperCase();
      await insertBooking({ booking_code: code });
      await expectPgError(
        insertBooking({ booking_code: code }),
        '23505',
        'uq_bookings_booking_code',
      );

      // Same key under a different hold is fine; under the same hold it is rejected.
      const holdA = await newHold();
      const holdB = await newHold();
      const first = await insertBooking({ hold_group_id: holdA, idempotency_key: 'same-key' });
      await insertBooking({ hold_group_id: holdB, idempotency_key: 'same-key' });

      // A second active booking for the hold is rejected until the first is no longer active.
      await expectPgError(
        insertBooking({ hold_group_id: holdA, idempotency_key: 'other-key' }),
        '23505',
        'uq_bookings_hold_group_active',
      );
      await knex('bookings').where({ id: first }).update({ status: 'expired' });
      // Same hold + same key is now rejected by the idempotency index alone.
      await expectPgError(
        insertBooking({ hold_group_id: holdA, idempotency_key: 'same-key' }),
        '23505',
        'uq_bookings_hold_idempotency',
      );
      await insertBooking({ hold_group_id: holdA, idempotency_key: 'other-key' });
    });

    it('enforces booking_seats, booking_concessions and concessions rules', async () => {
      const booking = await insertBooking();
      const showtime = await newShowtime();
      const seat = await newSeat();
      const row = {
        booking_id: booking,
        showtime_id: showtime,
        seat_id: seat,
        unit_price_vnd: 1000,
      };
      await knex('booking_seats').insert(row);
      await expectPgError(
        knex('booking_seats').insert(row),
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
      const [concession] = await knex('concessions')
        .insert({ name: 'Nước', unit_price_vnd: 20000 })
        .returning('id');
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
      await expectPgError(
        knex('booking_concessions').insert(line),
        '23505',
        'uq_booking_concessions_booking_concession',
      );
    });

    it('enforces ticket rules: unique qr hash, live seat uniqueness, status', async () => {
      const booking = await insertBooking();
      const showtime = await newShowtime();
      const seat = await newSeat();
      const ticket = {
        booking_id: booking,
        showtime_id: showtime,
        seat_id: seat,
        qr_token_hash: hex(16),
      };
      const [first] = await knex('tickets').insert(ticket).returning('id');

      await expectPgError(
        knex('tickets').insert({ ...ticket, seat_id: await newSeat() }),
        '23505',
        'uq_ticket_qr_hash',
      );
      await expectPgError(
        knex('tickets').insert({ ...ticket, qr_token_hash: hex(16) }),
        '23505',
        // booking+seat pair is hit first by the table-level unique index
        'uq_tickets_booking_seat',
      );
      // Another booking cannot hold a live ticket for the same showtime seat...
      const other = await insertBooking();
      const reissue = { ...ticket, booking_id: other, qr_token_hash: hex(16) };
      await expectPgError(
        knex('tickets').insert(reissue),
        '23505',
        'uq_tickets_showtime_seat_live',
      );
      // ...until the first ticket is cancelled.
      await knex('tickets').where({ id: first.id }).update({ status: 'cancelled' });
      await knex('tickets').insert(reissue);

      await expectPgError(
        knex('tickets').insert({
          ...ticket,
          booking_id: await insertBooking(),
          seat_id: await newSeat(),
          qr_token_hash: hex(16),
          status: 'bogus',
        }),
        '23514',
        'chk_tickets_status',
      );
    });

    it('restricts deleting a booking referenced by seat_allocations', async () => {
      const booking = await insertBooking();
      await expectPgError(
        knex('seat_allocations').insert({ booking_id: randomUUID() }),
        '23503',
        'fk_seat_allocations_booking',
      );
      await knex('seat_allocations').insert({ booking_id: booking });
      await expectPgError(
        knex('bookings').where({ id: booking }).del(),
        '23503',
        'fk_seat_allocations_booking',
      );
    });
  });

  if (!stubbed) {
    it.todo('BO-01 data-level constraint tests: add real CA-01/SH-01 fixtures after both merge');
  }

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

  it('rolls everything back and re-applies cleanly', async () => {
    await knex.migrate.rollback(undefined, true);
    const left = await knex.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'core' AND table_name IN
         ('bookings','booking_seats','booking_concessions','concessions','tickets')`,
    );
    expect(left.rows).toHaveLength(0);

    if (stubbed) {
      // Provisional stub rows would violate the re-added FK; the real table is empty after rollback.
      await knex.raw('TRUNCATE core.seat_allocations');
    }
    await knex.migrate.latest();
    const applied = await knex('knex_migrations').where('name', 'like', '20261122170%');
    expect(applied).toHaveLength(6);
  }, 60_000);
});
