import type { Knex } from 'knex';

/**
 * BO-01 — Migration: payment.payments
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * ERD: payments { id UUID PK, booking_id, provider, provider_payment_id, status, amount_vnd,
 *                 idempotency_key, processed_at }
 * Constraints:
 *   - status IN (initiated, succeeded, failed, refund_pending, refunded)
 *   - amount_vnd >= 0 (integer VND, D-18)
 *   - unique(booking_id, idempotency_key); unique(provider, provider_payment_id) when not null
 * Notes: booking_id is a logical reference to core.bookings (no cross-schema FK).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('payment').createTable('payments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('booking_id').notNullable();
    table.string('provider', 30).notNullable().defaultTo('mock');
    table.string('provider_payment_id', 255).nullable();
    table.string('status', 30).notNullable().defaultTo('initiated');
    table.bigInteger('amount_vnd').notNullable();
    table.string('idempotency_key', 128).notNullable();
    table.timestamp('processed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Scoped to the booking; its leading column also serves booking_id lookups.
    table.unique(['booking_id', 'idempotency_key'], {
      indexName: 'uq_payments_booking_idempotency',
    });
  });

  await knex.raw(`
    ALTER TABLE payment.payments
      ADD CONSTRAINT chk_payments_status CHECK (status IN
        ('initiated','succeeded','failed','refund_pending','refunded')),
      ADD CONSTRAINT chk_payments_amount_nonnegative CHECK (amount_vnd >= 0)
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_payment_provider_ref ON payment.payments (provider, provider_payment_id)
      WHERE provider_payment_id IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('payment').dropTableIfExists('payments');
}
