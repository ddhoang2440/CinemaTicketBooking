import type { Knex } from 'knex';

/**
 * BO-01 — Migration: payment.refunds
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * ERD: refunds { id UUID PK, payment_id FK, booking_id, amount_vnd, reason, status,
 *                idempotency_key, processed_at }
 * Constraints:
 *   - reason IN (customer_cancelled, hold_expired_compensation)
 *   - status IN (pending, succeeded, failed); amount_vnd >= 0
 *   - unique(idempotency_key); at most one non-failed refund per payment
 * Notes: mock refunds (D-07, P-08); booking_id is a logical reference to core.bookings.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('payment').createTable('refunds', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('payment_id').notNullable();
    table.uuid('booking_id').notNullable();
    table.bigInteger('amount_vnd').notNullable();
    table.string('reason', 40).notNullable();
    table.string('status', 20).notNullable().defaultTo('pending');
    table.string('idempotency_key', 128).notNullable();
    table.timestamp('processed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('payment_id', 'fk_refunds_payment')
      .references('id')
      .inTable('payment.payments')
      .onDelete('RESTRICT');
    table.unique(['idempotency_key'], { indexName: 'uq_refund_idempotency' });
    table.index(['payment_id'], 'idx_refunds_payment_id');
  });

  await knex.raw(`
    ALTER TABLE payment.refunds
      ADD CONSTRAINT chk_refunds_amount_nonnegative CHECK (amount_vnd >= 0),
      ADD CONSTRAINT chk_refunds_reason CHECK (reason IN ('customer_cancelled','hold_expired_compensation')),
      ADD CONSTRAINT chk_refunds_status CHECK (status IN ('pending','succeeded','failed'))
  `);
  // At most one non-failed refund per payment.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_refunds_payment_active ON payment.refunds (payment_id)
      WHERE status <> 'failed'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('payment').dropTableIfExists('refunds');
}
