import type { Knex } from 'knex';

/**
 * BO-01 — Migration: core.booking_seats
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * ERD: booking_seats { id UUID PK, booking_id FK, showtime_id FK, seat_id FK, unit_price_vnd }
 * Constraints:
 *   - unit_price_vnd >= 0
 *   - unique(booking_id, seat_id)
 *   - showtime_id must match the showtime of the booking's hold_group_id
 *   - seat_id must belong to the same auditorium as showtime_id
 * Notes: max 8 physical seats per booking (D-06) and couple seat completeness (D-15)
 *        are enforced inside the core-service booking transaction.
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
    'ALTER TABLE core.booking_seats ADD CONSTRAINT chk_booking_seats_price_nonnegative CHECK (unit_price_vnd >= 0)',
  );

  // Enforce showtime & auditorium consistency between booking -> hold_group -> showtime and seat -> auditorium
  await knex.raw(`
    CREATE OR REPLACE FUNCTION core.fn_check_booking_seat_consistency()
    RETURNS TRIGGER AS $$
    DECLARE
      expected_showtime_id UUID;
      showtime_auditorium_id UUID;
      seat_auditorium_id UUID;
    BEGIN
      SELECT shg.showtime_id
        INTO expected_showtime_id
        FROM core.bookings b
        JOIN core.seat_hold_groups shg ON shg.id = b.hold_group_id
       WHERE b.id = NEW.booking_id;

      IF expected_showtime_id IS NOT NULL AND expected_showtime_id <> NEW.showtime_id THEN
        RAISE EXCEPTION 'booking_seats.showtime_id (%) does not match booking showtime_id (%)',
          NEW.showtime_id, expected_showtime_id
          USING ERRCODE = '23514',
                CONSTRAINT = 'chk_booking_seat_showtime_matches_booking';
      END IF;

      SELECT s.auditorium_id
        INTO showtime_auditorium_id
        FROM core.showtimes s
       WHERE s.id = NEW.showtime_id;

      SELECT st.auditorium_id
        INTO seat_auditorium_id
        FROM core.seats st
       WHERE st.id = NEW.seat_id;

      IF showtime_auditorium_id IS NOT NULL
         AND seat_auditorium_id IS NOT NULL
         AND showtime_auditorium_id <> seat_auditorium_id THEN
        RAISE EXCEPTION 'booking_seats.seat_id auditorium (%) does not match showtime auditorium (%)',
          seat_auditorium_id, showtime_auditorium_id
          USING ERRCODE = '23514',
                CONSTRAINT = 'chk_booking_seat_auditorium_matches_showtime';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_booking_seats_consistency
      BEFORE INSERT OR UPDATE ON core.booking_seats
      FOR EACH ROW
      EXECUTE FUNCTION core.fn_check_booking_seat_consistency();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('booking_seats');
  await knex.raw('DROP FUNCTION IF EXISTS core.fn_check_booking_seat_consistency() CASCADE');
}
