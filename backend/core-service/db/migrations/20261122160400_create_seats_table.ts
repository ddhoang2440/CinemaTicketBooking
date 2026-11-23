import type { Knex } from 'knex';

/**
 * CA-01 — Migration 5/6: core.seats
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * ERD: seats { id UUID PK, auditorium_id FK, row_label, seat_number, seat_type,
 *              couple_pair_id nullable FK, is_active }
 * Constraints:
 *   - unique(auditorium_id, row_label, seat_number)
 *   - unique(id, auditorium_id) — required by SH-01 composite FKs on seat_holds and seat_allocations
 *   - composite FK (couple_pair_id, auditorium_id) -> core.seat_pairs(id, auditorium_id)
 *   - seat_number > 0
 *   - couple seats must have non-null couple_pair_id (D-15)
 *   - non-couple seats must have null couple_pair_id
 *   - at most 2 seats per couple_pair_id enforced by trigger (D-15)
 * Reference: docs/02-architecture/ERD.md §2.1 & §5, DATABASE-IMPLEMENTATION.md §2
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('seats', (table) => {
    table
      .uuid('id')
      .primary()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .uuid('auditorium_id')
      .notNullable()
      .references('id')
      .inTable('core.auditoriums')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');

    table
      .string('row_label', 5)
      .notNullable()
      .comment('Row letter: A, B, C, ..., J');

    table
      .integer('seat_number')
      .notNullable()
      .comment('Seat number within row: 1, 2, 3, ...');

    table
      .string('seat_type', 20)
      .notNullable()
      .defaultTo('standard')
      .comment('standard | vip | couple');

    table.uuid('couple_pair_id').nullable();

    table.boolean('is_active').notNullable().defaultTo(true);

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Unique position within auditorium (also serves as idx_seat_pair_position per DATABASE-IMPLEMENTATION.md §2)
    table.unique(['auditorium_id', 'row_label', 'seat_number'], {
      indexName: 'uq_seats_auditorium_position',
    });

    // Composite unique constraint: required by SH-01 composite FKs (seat_id, auditorium_id)
    table.unique(['id', 'auditorium_id'], {
      indexName: 'uq_seats_id_auditorium',
    });

    // Composite FK: ensures couple_pair_id belongs to the exact same auditorium_id (D-15)
    table
      .foreign(['couple_pair_id', 'auditorium_id'], 'fk_seats_couple_pair')
      .references(['id', 'auditorium_id'])
      .inTable('core.seat_pairs')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');

    // FK & query indexes
    table.index('auditorium_id', 'idx_seats_auditorium_id');
    table.index('couple_pair_id', 'idx_seats_couple_pair_id');
    table.index('seat_type', 'idx_seats_seat_type');
  });

  // Check constraints: seat_number > 0, valid seat_type, and couple_pair_id consistency (ERD §5 / D-15)
  await knex.raw(`
    ALTER TABLE core.seats
      ADD CONSTRAINT chk_seats_seat_number_positive
        CHECK (seat_number > 0),
      ADD CONSTRAINT chk_seats_seat_type
        CHECK (seat_type IN ('standard', 'vip', 'couple')),
      ADD CONSTRAINT chk_seats_couple_pair_consistency
        CHECK (
          (seat_type = 'couple' AND couple_pair_id IS NOT NULL)
          OR
          (seat_type <> 'couple' AND couple_pair_id IS NULL)
        )
  `);

  // D-15: Enforce that a couple_pair_id can link at most 2 physical seats
  await knex.raw(`
    CREATE OR REPLACE FUNCTION core.fn_check_couple_pair_max_two()
    RETURNS TRIGGER AS $$
    DECLARE
      existing_count INTEGER;
    BEGIN
      IF NEW.couple_pair_id IS NOT NULL THEN
        SELECT COUNT(*)
          INTO existing_count
          FROM core.seats
         WHERE couple_pair_id = NEW.couple_pair_id
           AND id <> NEW.id;

        IF existing_count >= 2 THEN
          RAISE EXCEPTION 'couple_pair_id % already links 2 seats (D-15)', NEW.couple_pair_id
            USING ERRCODE = '23514',
                  CONSTRAINT = 'chk_seats_couple_pair_max_two';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_seats_couple_pair_max_two
      BEFORE INSERT OR UPDATE OF couple_pair_id ON core.seats
      FOR EACH ROW
      EXECUTE FUNCTION core.fn_check_couple_pair_max_two();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('seats');
  await knex.raw('DROP FUNCTION IF EXISTS core.fn_check_couple_pair_max_two() CASCADE');
}
