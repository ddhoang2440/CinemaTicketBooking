import type { Knex } from 'knex';

/**
 * BO-01 — Migration: FK core.seat_allocations.booking_id -> core.bookings(id)
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * Deferred FK requested by SH-01 (SH01_DEPENDENCIES.md section 4) to avoid a circular
 * dependency between seat_allocations and bookings.
 * Depends on: SH-01 core.seat_allocations.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE core.seat_allocations
      ADD CONSTRAINT fk_seat_allocations_booking
      FOREIGN KEY (booking_id) REFERENCES core.bookings (id) ON DELETE RESTRICT
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE core.seat_allocations DROP CONSTRAINT IF EXISTS fk_seat_allocations_booking',
  );
}
