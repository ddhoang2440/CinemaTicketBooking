import type { Knex } from 'knex';

/**
 * BO-01 — Migration: core.booking_seats
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * ERD: booking_seats { id UUID PK, booking_id FK, showtime_id FK, seat_id FK, unit_price_vnd }
 * Constraints: unique(booking_id, seat_id), unit_price_vnd >= 0 (price per physical seat)
 * Depends on: CA-01 core.seats, SH-01 core.showtimes.
 * Notes: max 8 physical seats per booking (D-06) is enforced by the service.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('booking_seats', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('booking_id').notNullable();
    table.uuid('showtime_id').notNullable();
    table.uuid('seat_id').notNullable();
    table.bigInteger('unit_price_vnd').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('booking_id', 'fk_booking_seats_booking')
      .references('id')
      .inTable('core.bookings')
      .onDelete('RESTRICT');
    table
      .foreign('showtime_id', 'fk_booking_seats_showtime')
      .references('id')
      .inTable('core.showtimes')
      .onDelete('RESTRICT');
    table
      .foreign('seat_id', 'fk_booking_seats_seat')
      .references('id')
      .inTable('core.seats')
      .onDelete('RESTRICT');
    table.unique(['booking_id', 'seat_id'], { indexName: 'uq_booking_seats_booking_seat' });
    table.index(['showtime_id', 'seat_id'], 'idx_booking_seats_showtime_seat');
  });

  await knex.raw(
    'ALTER TABLE core.booking_seats ADD CONSTRAINT chk_booking_seats_unit_price_nonnegative CHECK (unit_price_vnd >= 0)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('booking_seats');
}
