import type { Knex } from 'knex';

/**
 * BO-01 — Migration: core.tickets
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * ERD: tickets { id UUID PK, booking_id FK, showtime_id FK, seat_id FK, qr_token_hash, status, issued_at }
 * Constraints:
 *   - status IN (valid, used, cancelled)
 *   - unique(qr_token_hash); unique(booking_id, seat_id)
 *   - at most one live ticket (status <> 'cancelled') per (showtime_id, seat_id)
 * Notes: the plaintext QR token is never stored (R-17); the service must derive it
 *        deterministically (e.g. HMAC(secret, ticket_id)) and persist only its hash.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('tickets', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('booking_id').notNullable();
    table.uuid('showtime_id').notNullable();
    table.uuid('seat_id').notNullable();
    table.string('qr_token_hash', 255).notNullable();
    table.string('status', 20).notNullable().defaultTo('valid');
    table.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('booking_id', 'fk_tickets_booking')
      .references('id')
      .inTable('core.bookings')
      .onDelete('RESTRICT');
    table
      .foreign('showtime_id', 'fk_tickets_showtime')
      .references('id')
      .inTable('core.showtimes')
      .onDelete('RESTRICT');
    table
      .foreign('seat_id', 'fk_tickets_seat')
      .references('id')
      .inTable('core.seats')
      .onDelete('RESTRICT');
    table.unique(['qr_token_hash'], { indexName: 'uq_ticket_qr_hash' });
    table.unique(['booking_id', 'seat_id'], { indexName: 'uq_tickets_booking_seat' });
  });

  await knex.raw(
    "ALTER TABLE core.tickets ADD CONSTRAINT chk_tickets_status CHECK (status IN ('valid','used','cancelled'))",
  );
  // At most one live ticket per seat per showtime.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_tickets_showtime_seat_live ON core.tickets (showtime_id, seat_id)
      WHERE status <> 'cancelled'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('tickets');
}
