import type { Knex } from 'knex';

/**
 * CA-01 — Migration 3/6: core.auditoriums
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * ERD: auditoriums { id UUID PK, cinema_id FK, name, supported_formats, status }
 * Constraints:
 *   - unique(cinema_id, name)
 *   - unique(id, cinema_id) — required by SH-01 composite FK fk_showtimes_auditorium_cinema
 *   - total_seats >= 0
 *   - status IN ('active', 'inactive', 'maintenance')
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('auditoriums', (table) => {
    table
      .uuid('id')
      .primary()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .uuid('cinema_id')
      .notNullable()
      .references('id')
      .inTable('core.cinemas')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');

    table.string('name', 100).notNullable();
    table.integer('total_seats').notNullable().defaultTo(0);
    table
      .specificType('supported_formats', 'text[]')
      .notNullable()
      .defaultTo(knex.raw("ARRAY['2D']::text[]"))
      .comment('Array of formats: 2D, 3D, IMAX, 4DX');
    table
      .string('status', 20)
      .notNullable()
      .defaultTo('active')
      .comment('active | inactive | maintenance');

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Unique constraint: no duplicate auditorium name within the same cinema
    table.unique(['cinema_id', 'name'], {
      indexName: 'uq_auditoriums_cinema_name',
    });

    // Composite unique constraint: enables SH-01 showtimes composite FK (auditorium_id, cinema_id)
    table.unique(['id', 'cinema_id'], {
      indexName: 'uq_auditoriums_id_cinema',
    });

    // FK index per ERD §1 rule
    table.index('cinema_id', 'idx_auditoriums_cinema_id');
    table.index('status', 'idx_auditoriums_status');
  });

  await knex.raw(`
    ALTER TABLE core.auditoriums
      ADD CONSTRAINT chk_auditoriums_total_seats_nonnegative
        CHECK (total_seats >= 0),
      ADD CONSTRAINT chk_auditoriums_status
        CHECK (status IN ('active', 'inactive', 'maintenance'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('auditoriums');
}
