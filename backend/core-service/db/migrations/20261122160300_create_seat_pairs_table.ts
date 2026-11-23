import type { Knex } from 'knex';

/**
 * CA-01 — Migration 4/6: core.seat_pairs
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * ERD: seat_pairs { id UUID PK, auditorium_id FK, created_at }
 * Constraints: unique(id, auditorium_id) per D-15
 * Reference: docs/02-architecture/DATABASE-IMPLEMENTATION.md §2
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('seat_pairs', (table) => {
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
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // D-15: composite unique ensures pair belongs to one specific auditorium.
    // Allows seats to have a composite FK (couple_pair_id, auditorium_id) -> seat_pairs(id, auditorium_id).
    table.unique(['id', 'auditorium_id'], {
      indexName: 'uq_seat_pairs_id_auditorium',
    });

    // FK index
    table.index('auditorium_id', 'idx_seat_pairs_auditorium_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('seat_pairs');
}
