import type { Knex } from 'knex';

/**
 * CA-01 — Migration: core.seats
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * ERD: seats { id UUID PK, auditorium_id FK, row_label, seat_number, seat_type,
 *              couple_pair_id nullable FK, is_active }
 * Constraints:
 *   - unique(auditorium_id, row_label, seat_number) — no duplicate positions
 *   - seat_type IN ('standard', 'vip', 'couple')
 *   - couple seats must have non-null couple_pair_id (D-15)
 *   - non-couple seats must have null couple_pair_id
 *   - exactly 2 seats per couple_pair_id (enforced at application level + test)
 *
 * References: ERD §2.1, BUSINESS-RULES R-04, DECISIONS D-15
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('seats', (table) => {
    // PK — UUID v4
    table
      .uuid('id')
      .primary()
      .defaultTo(knex.raw('uuid_generate_v4()'));

    // FK to auditoriums
    table
      .uuid('auditorium_id')
      .notNullable()
      .references('id')
      .inTable('auditoriums')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');

    // Seat position
    table.string('row_label', 5).notNullable(); // e.g., 'A', 'B', 'C', ...
    table.integer('seat_number').notNullable(); // e.g., 1, 2, 3, ...

    // Seat type: standard, vip, couple (D-15)
    table
      .string('seat_type', 20)
      .notNullable()
      .defaultTo('standard')
      .checkIn(
        ['standard', 'vip', 'couple'],
        'ck_seats_type_valid',
      );

    // Couple pair reference (D-15) — nullable, only for seat_type='couple'
    table
      .uuid('couple_pair_id')
      .nullable()
      .references('id')
      .inTable('seat_pairs')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');

    // Active status (soft-disable, not soft-delete — R-07)
    table.boolean('is_active').notNullable().defaultTo(true);

    // Timestamps UTC (D-18)
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Unique constraint: no duplicate seat position within the same auditorium
    table.unique(['auditorium_id', 'row_label', 'seat_number'], {
      indexName: 'uq_seats_auditorium_position',
    });

    // Indexes
    table.index('auditorium_id', 'idx_seats_auditorium_id');
    table.index('couple_pair_id', 'idx_seats_couple_pair_id');
    table.index('seat_type', 'idx_seats_seat_type');
    table.index('is_active', 'idx_seats_is_active');
  });

  // Check constraint: couple seats must have couple_pair_id, others must not
  // Knex doesn't have native support for complex CHECK constraints, use raw SQL
  await knex.raw(`
    ALTER TABLE seats
    ADD CONSTRAINT ck_seats_couple_pair_consistency
    CHECK (
      (seat_type = 'couple' AND couple_pair_id IS NOT NULL)
      OR
      (seat_type <> 'couple' AND couple_pair_id IS NULL)
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('seats');
}
