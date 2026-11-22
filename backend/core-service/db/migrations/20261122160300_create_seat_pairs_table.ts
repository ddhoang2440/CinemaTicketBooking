import type { Knex } from 'knex';

/**
 * CA-01 — Migration: core.seat_pairs
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * ERD: seat_pairs { id UUID PK, auditorium_id FK, created_at }
 * Constraints: unique(id, auditorium_id) — for composite FK from seats (D-15)
 *
 * Each seat_pair links exactly 2 seats of type 'couple'.
 * Couple pair integrity (exactly 2 seats per pair) is enforced
 * in application-level transactions and validated by tests.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('seat_pairs', (table) => {
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

    // Timestamps UTC (D-18)
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Composite unique for referencing from seats (D-15)
    // Allows seats to have a composite FK (couple_pair_id, auditorium_id)
    // ensuring the pair belongs to the same auditorium
    table.unique(['id', 'auditorium_id'], {
      indexName: 'uq_seat_pairs_id_auditorium',
    });

    // Index on auditorium_id (FK index)
    table.index('auditorium_id', 'idx_seat_pairs_auditorium_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('seat_pairs');
}
