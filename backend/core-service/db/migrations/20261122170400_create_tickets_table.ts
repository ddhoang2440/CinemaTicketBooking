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
 *   - showtime_id must match the showtime of the booking's hold_group_id
 *   - seat_id must belong to the same auditorium as showtime_id
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
    table.index(['showtime_id'], 'idx_tickets_showtime_id');
    table.index(['seat_id'], 'idx_tickets_seat_id');
  });

  await knex.raw(
    "ALTER TABLE core.tickets ADD CONSTRAINT chk_tickets_status CHECK (status IN ('valid','used','cancelled'))",
  );
  // At most one live ticket per seat per showtime.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_tickets_showtime_seat_live ON core.tickets (showtime_id, seat_id)
      WHERE status <> 'cancelled'
  `);

  // Enforce showtime & auditorium consistency between booking -> hold_group -> showtime and seat -> auditorium
  await knex.raw(`
    CREATE OR REPLACE FUNCTION core.fn_check_ticket_consistency()
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
        RAISE EXCEPTION 'tickets.showtime_id (%) does not match booking showtime_id (%)',
          NEW.showtime_id, expected_showtime_id
          USING ERRCODE = '23514',
                CONSTRAINT = 'chk_ticket_showtime_matches_booking';
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
        RAISE EXCEPTION 'tickets.seat_id auditorium (%) does not match showtime auditorium (%)',
          seat_auditorium_id, showtime_auditorium_id
          USING ERRCODE = '23514',
                CONSTRAINT = 'chk_ticket_auditorium_matches_showtime';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_tickets_consistency
      BEFORE INSERT OR UPDATE ON core.tickets
      FOR EACH ROW
      EXECUTE FUNCTION core.fn_check_ticket_consistency();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('tickets');
  await knex.raw('DROP FUNCTION IF EXISTS core.fn_check_ticket_consistency() CASCADE');
}
