import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory from 'knex';
import type { Knex } from 'knex';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Needs a PostgreSQL URL with CREATEDB (any database); the suite creates and drops its own database.
const adminUrl = process.env.BO01_TEST_DATABASE_URL;

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'db',
  'migrations',
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

describe.skipIf(!adminUrl)('BO-01 payment migrations (payments, payment_events, refunds)', () => {
  const dbName = `bo01_pay_${hex()}`;
  let admin: pg.Client;
  let knex: Knex;

  async function insertPayment(overrides: Record<string, unknown> = {}): Promise<string> {
    const [row] = await knex('payments')
      .insert({
        booking_id: randomUUID(),
        amount_vnd: 90000,
        idempotency_key: hex(8),
        ...overrides,
      })
      .returning('id');
    return row.id as string;
  }

  function refundRow(paymentId: string, overrides: Record<string, unknown> = {}) {
    return {
      payment_id: paymentId,
      booking_id: randomUUID(),
      amount_vnd: 90000,
      reason: 'customer_cancelled',
      idempotency_key: hex(8),
      ...overrides,
    };
  }

  beforeAll(async () => {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    admin = client;
    await admin.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);

    knex = knexFactory({
      client: 'pg',
      connection: urlForDatabase(adminUrl ?? '', dbName),
      searchPath: ['payment'],
      pool: { min: 1, max: 5 },
      migrations: {
        directory: migrationsDir,
        schemaName: 'payment',
        tableName: 'knex_migrations',
        extension: 'ts',
        loadExtensions: ['.ts'],
      },
    });
    await knex.raw('CREATE SCHEMA IF NOT EXISTS payment');
    await knex.migrate.latest();
  }, 60_000);

  afterAll(async () => {
    await knex?.destroy();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30_000);

  it('applies the 3 migrations with bigint money, named constraints and no cross-schema FK', async () => {
    const applied = await knex('knex_migrations').pluck('name');
    for (const name of [
      '20261122170000_create_payments_table.ts',
      '20261122170100_create_payment_events_table.ts',
      '20261122170200_create_refunds_table.ts',
    ]) {
      expect(applied, name).toContain(name);
    }

    const money = await knex.raw(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'payment' AND column_name = 'amount_vnd'`,
    );
    expect(money.rows.map((r: { data_type: string }) => r.data_type)).toEqual(['bigint', 'bigint']);

    const names = await knex.raw(
      `SELECT conname AS n FROM pg_constraint WHERE connamespace = 'payment'::regnamespace
       UNION SELECT indexname FROM pg_indexes WHERE schemaname = 'payment'`,
    );
    const have = new Set(names.rows.map((r: { n: string }) => r.n));
    for (const expected of [
      'chk_payments_status',
      'chk_payments_amount_nonnegative',
      'uq_payments_booking_idempotency',
      'uq_payment_provider_ref',
      'uq_payment_provider_event',
      'chk_payment_events_event_type',
      'fk_payment_events_payment',
      'idx_payment_events_payment_id',
      'chk_refunds_amount_nonnegative',
      'chk_refunds_reason',
      'chk_refunds_status',
      'uq_refund_idempotency',
      'uq_refunds_payment_active',
      'fk_refunds_payment',
      'idx_refunds_payment_id',
    ]) {
      expect(have, expected).toContain(expected);
    }

    const crossSchema = await knex.raw(
      `SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid
       WHERE c.contype = 'f' AND c.connamespace = 'payment'::regnamespace
         AND t.relnamespace <> 'payment'::regnamespace`,
    );
    expect(crossSchema.rows).toHaveLength(0);

    // Every FK is ON DELETE RESTRICT (confdeltype 'r'): payment history must never cascade away.
    const fks = await knex.raw(
      `SELECT conname, confdeltype FROM pg_constraint
       WHERE contype = 'f' AND connamespace = 'payment'::regnamespace`,
    );
    expect(fks.rows.length).toBeGreaterThan(0);
    for (const fk of fks.rows) {
      expect(fk.confdeltype, fk.conname).toBe('r');
    }
  });

  it('allows NULL only in the optional columns', async () => {
    const nullable = await knex.raw(
      `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
       WHERE table_schema = 'payment' AND is_nullable = 'YES' AND table_name IN
         ('payments','payment_events','refunds') ORDER BY 1`,
    );
    expect(nullable.rows.map((r: { c: string }) => r.c)).toEqual([
      'payments.processed_at',
      'payments.provider_payment_id',
      'refunds.processed_at',
    ]);
  });

  it('stores a payment lifecycle with event and refund', async () => {
    const paymentId = await insertPayment({ amount_vnd: '9007199254740993' });
    const payment = await knex('payments').where({ id: paymentId }).first();
    expect(payment.status).toBe('initiated');
    expect(payment.provider).toBe('mock');
    expect(payment.amount_vnd).toBe('9007199254740993');

    await knex('payment_events').insert({
      provider_event_id: `evt_${hex()}`,
      payment_id: paymentId,
      event_type: 'succeeded',
    });
    await knex('payments').where({ id: paymentId }).update({ status: 'refund_pending' });
    await knex('refunds').insert(refundRow(paymentId));
    await knex('payments').where({ id: paymentId }).update({ status: 'refunded' });
    expect((await knex('payments').where({ id: paymentId }).first()).status).toBe('refunded');
  });

  it.each(['initiated', 'succeeded', 'failed', 'refund_pending', 'refunded'])(
    'accepts payment status %s',
    async (status) => {
      await insertPayment({ status });
    },
  );

  it.each(['pending', 'succeeded', 'failed'])('accepts refund status %s', async (status) => {
    await knex('refunds').insert(refundRow(await insertPayment(), { status }));
  });

  it('validates payment status, amount and uniqueness rules', async () => {
    await expectPgError(insertPayment({ status: 'bogus' }), '23514', 'chk_payments_status');
    await expectPgError(
      insertPayment({ amount_vnd: -1 }),
      '23514',
      'chk_payments_amount_nonnegative',
    );

    await insertPayment({ amount_vnd: 0 });

    // Idempotency key is scoped to the booking; a booking may retry with another key.
    const bookingA = randomUUID();
    await insertPayment({ booking_id: bookingA, idempotency_key: 'k' });
    await insertPayment({ booking_id: bookingA, idempotency_key: 'k2' });
    await insertPayment({ booking_id: randomUUID(), idempotency_key: 'k' });
    await expectPgError(
      insertPayment({ booking_id: bookingA, idempotency_key: 'k' }),
      '23505',
      'uq_payments_booking_idempotency',
    );

    // Provider reference is unique only when present.
    await insertPayment({ provider_payment_id: null });
    await insertPayment({ provider_payment_id: null });
    const ref = `mock_${hex()}`;
    await insertPayment({ provider_payment_id: ref });
    await expectPgError(
      insertPayment({ provider_payment_id: ref }),
      '23505',
      'uq_payment_provider_ref',
    );
  });

  it('deduplicates webhook events and validates event type and FK', async () => {
    const paymentId = await insertPayment();
    const event = {
      provider_event_id: `evt_${hex()}`,
      payment_id: paymentId,
      event_type: 'failed',
    };
    await knex('payment_events').insert(event);
    await expectPgError(knex('payment_events').insert(event), '23505', 'uq_payment_provider_event');
    await expectPgError(
      knex('payment_events').insert({
        ...event,
        provider_event_id: `evt_${hex()}`,
        event_type: 'bogus',
      }),
      '23514',
      'chk_payment_events_event_type',
    );
    await expectPgError(
      knex('payment_events').insert({
        ...event,
        provider_event_id: `evt_${hex()}`,
        payment_id: randomUUID(),
      }),
      '23503',
      'fk_payment_events_payment',
    );
  });

  it('validates refund amount, reason, status and idempotency', async () => {
    const paymentId = await insertPayment();
    await expectPgError(
      knex('refunds').insert(refundRow(paymentId, { amount_vnd: -1 })),
      '23514',
      'chk_refunds_amount_nonnegative',
    );
    await expectPgError(
      knex('refunds').insert(refundRow(paymentId, { reason: 'bogus' })),
      '23514',
      'chk_refunds_reason',
    );
    await expectPgError(
      knex('refunds').insert(refundRow(paymentId, { status: 'bogus' })),
      '23514',
      'chk_refunds_status',
    );

    const first = refundRow(paymentId, { reason: 'hold_expired_compensation', amount_vnd: 0 });
    await knex('refunds').insert(first);
    await expectPgError(
      knex('refunds').insert(
        refundRow(await insertPayment(), { idempotency_key: first.idempotency_key }),
      ),
      '23505',
      'uq_refund_idempotency',
    );
  });

  it('allows only one non-failed refund per payment', async () => {
    const paymentId = await insertPayment();
    const [first] = await knex('refunds').insert(refundRow(paymentId)).returning(['id', 'status']);
    expect(first.status).toBe('pending');
    for (const status of ['pending', 'succeeded']) {
      await knex('refunds').where({ id: first.id }).update({ status });
      await expectPgError(
        knex('refunds').insert(refundRow(paymentId)),
        '23505',
        'uq_refunds_payment_active',
      );
    }
    await knex('refunds').where({ id: first.id }).update({ status: 'failed' });
    await knex('refunds').insert(refundRow(paymentId));
  });

  it('rolls everything back and re-applies cleanly', async () => {
    await knex.migrate.rollback(undefined, true);
    const left = await knex.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'payment' AND table_name IN ('payments','payment_events','refunds')`,
    );
    expect(left.rows).toHaveLength(0);

    await knex.migrate.latest();
    expect(await knex('knex_migrations').pluck('name')).toContain(
      '20261122170200_create_refunds_table.ts',
    );
  }, 60_000);
});
