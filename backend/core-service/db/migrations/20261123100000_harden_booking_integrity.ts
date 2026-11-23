import type { Knex } from 'knex';

/**
 * BO-01 — Migration: harden booking integrity (follow-up to the 20261122170xxx set)
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * Changes:
 *   - unique(booking_id, showtime_id, seat_id) on core.booking_seats (target of the composite FK)
 *   - core.tickets (booking_id, showtime_id, seat_id) -> core.booking_seats, ON DELETE RESTRICT:
 *     a ticket can only be issued for a seat that is booked for that showtime
 *   - FK-column indexes from ERD section 1: booking_seats.seat_id, tickets.seat_id,
 *     tickets.showtime_id, booking_concessions.concession_id
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE core.booking_seats
      ADD CONSTRAINT uq_booking_seats_booking_showtime_seat UNIQUE (booking_id, showtime_id, seat_id)
  `);
  await knex.raw(`
    ALTER TABLE core.tickets
      ADD CONSTRAINT fk_tickets_booking_seat
      FOREIGN KEY (booking_id, showtime_id, seat_id)
      REFERENCES core.booking_seats (booking_id, showtime_id, seat_id) ON DELETE RESTRICT
  `);
  await knex.raw('CREATE INDEX idx_booking_seats_seat_id ON core.booking_seats (seat_id)');
  await knex.raw('CREATE INDEX idx_tickets_seat_id ON core.tickets (seat_id)');
  await knex.raw('CREATE INDEX idx_tickets_showtime_id ON core.tickets (showtime_id)');
  await knex.raw(
    'CREATE INDEX idx_booking_concessions_concession_id ON core.booking_concessions (concession_id)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS core.idx_booking_concessions_concession_id');
  await knex.raw('DROP INDEX IF EXISTS core.idx_tickets_showtime_id');
  await knex.raw('DROP INDEX IF EXISTS core.idx_tickets_seat_id');
  await knex.raw('DROP INDEX IF EXISTS core.idx_booking_seats_seat_id');
  await knex.raw('ALTER TABLE core.tickets DROP CONSTRAINT IF EXISTS fk_tickets_booking_seat');
  await knex.raw(
    'ALTER TABLE core.booking_seats DROP CONSTRAINT IF EXISTS uq_booking_seats_booking_showtime_seat',
  );
}
