import type { Knex } from 'knex';

/**
 * CA-01 — Migration 1/6: core.movies
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * ERD: movies { id UUID PK, title, synopsis, duration_min, age_rating, poster_url, status }
 * Constraints:
 *   - duration_min > 0
 *   - age_rating IN ('P', 'C13', 'C16', 'C18')
 *   - status IN ('active', 'inactive', 'now_showing', 'coming_soon', 'hidden')
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS core');

  await knex.schema.withSchema('core').createTable('movies', (table) => {
    table
      .uuid('id')
      .primary()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table.string('title', 255).notNullable();
    table.text('synopsis').nullable();
    table.integer('duration_min').notNullable();
    table
      .string('age_rating', 10)
      .notNullable()
      .defaultTo('P')
      .comment('P | C13 | C16 | C18');
    table.string('poster_url', 500).nullable();
    table.date('release_date').nullable();
    table
      .string('status', 20)
      .notNullable()
      .defaultTo('active')
      .comment('active | inactive | now_showing | coming_soon | hidden');

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Indexes for filtering & searching
    table.index('status', 'idx_movies_status');
    table.index('title', 'idx_movies_title');
    table.index('release_date', 'idx_movies_release_date');
  });

  // Check constraints: duration_min > 0, valid age_rating, valid status
  await knex.raw(`
    ALTER TABLE core.movies
      ADD CONSTRAINT chk_movies_duration_positive
        CHECK (duration_min > 0),
      ADD CONSTRAINT chk_movies_age_rating
        CHECK (age_rating IN ('P', 'C13', 'C16', 'C18')),
      ADD CONSTRAINT chk_movies_status
        CHECK (status IN ('active', 'inactive', 'now_showing', 'coming_soon', 'hidden'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('movies');
}
