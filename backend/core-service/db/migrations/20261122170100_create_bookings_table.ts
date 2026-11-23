import type { Knex } from 'knex';

/**
 * BO-01 — Migration: core.bookings
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * ERD: bookings { id UUID PK, booking_code, user_id UUID nullable, contact_name, contact_email,
 *                 contact_phone nullable, guest_token_hash nullable, hold_group_id FK,
 *                 payment_id nullable, idempotency_key, status, total_vnd, expires_at,
 *                 confirmed_at, cancelled_at }
 * Constraints:
 *   - status IN (pending_payment, confirmed, payment_failed, expired, cancellation_pending, cancelled)
 *   - owner XOR: user_id (customer) or guest_token_hash (guest, D-08), never both or neither
 *   - total_vnd >= 0 (integer VND, D-18)
 *   - unique(booking_code); unique(hold_group_id, idempotency_key); at most one active booking per hold_group
 * Depends on: TV1 core.users (uuid id), TV3 core.seat_hold_groups (uuid id).
 * Notes: payment_id is a logical reference to payment.payments (no cross-schema FK per D-04).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('bookings', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('booking_code', 32).notNullable();
    table.uuid('user_id').nullable();
    table.string('contact_name', 120).notNullable();
    table.string('contact_email', 255).notNullable();
    table.string('contact_phone', 20).nullable();
    table.string('guest_token_hash', 255).nullable();
    table.uuid('hold_group_id').notNullable();
    table.uuid('payment_id').nullable();
    table.string('idempotency_key', 128).notNullable();
    table.string('status', 30).notNullable().defaultTo('pending_payment');
    table.bigInteger('total_vnd').notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('confirmed_at', { useTz: true }).nullable();
    table.timestamp('cancelled_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('user_id', 'fk_bookings_user')
      .references('id')
      .inTable('core.users')
      .onDelete('RESTRICT');
    table
      .foreign('hold_group_id', 'fk_bookings_hold_group')
      .references('id')
      .inTable('core.seat_hold_groups')
      .onDelete('RESTRICT');

    table.unique(['booking_code'], { indexName: 'uq_bookings_code' });
    // Scoped to the hold group; its leading column also indexes hold_group_id lookups.
    table.unique(['hold_group_id', 'idempotency_key'], {
      indexName: 'uq_bookings_hold_group_idempotency',
    });
  });

  await knex.raw(`
    ALTER TABLE core.bookings
      ADD CONSTRAINT chk_bookings_status CHECK (status IN
        ('pending_payment','confirmed','payment_failed','expired','cancellation_pending','cancelled')),
      ADD CONSTRAINT chk_bookings_owner CHECK (
        (user_id IS NOT NULL AND guest_token_hash IS NULL)
        OR (user_id IS NULL AND guest_token_hash IS NOT NULL)),
      ADD CONSTRAINT chk_bookings_total_nonnegative CHECK (total_vnd >= 0)
  `);
  // Supports GET /api/v1/bookings/me ordered by most recent first.
  await knex.raw(
    'CREATE INDEX idx_bookings_user_created ON core.bookings (user_id, created_at DESC)',
  );
  // Terminal failed/expired/cancelled attempts on a hold do not block a fresh booking,
  // but two live bookings for the same hold group cannot coexist.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_bookings_hold_group_active ON core.bookings (hold_group_id)
      WHERE status IN ('pending_payment','confirmed','cancellation_pending')
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('bookings');
}
