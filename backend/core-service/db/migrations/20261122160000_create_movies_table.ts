import type { Knex } from 'knex';

/**
 * CA-01 — Migration: core.movies
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * ERD: movies { id UUID PK, title, synopsis, duration_min, age_rating, poster_url, status }
 * Constraints: duration_min > 0
 * Conventions: UUID PK, timestamptz UTC (D-18), soft-delete via status
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  await knex.schema.createTable('movies', (table) => {
    // PK — UUID v4
    table
      .uuid('id')
      .primary()
      .defaultTo(knex.raw('uuid_generate_v4()'));

    // Core fields
    table.string('title', 500).notNullable();
    table.text('synopsis').nullable();
    table
      .integer('duration_min')
      .notNullable()
      .checkPositive('ck_movies_duration_positive'); // duration_min > 0
    table.string('age_rating', 10).notNullable().defaultTo('P');
    // age_rating: P (phổ thông), C13, C16, C18 — matches Vietnamese film rating
    table.string('poster_url', 2048).nullable();
    table.string('trailer_url', 2048).nullable();

    // Catalog metadata
    table.string('director', 255).nullable();
    table.text('cast_list').nullable(); // JSON array stored as text or comma-separated
    table.specificType('genres', 'text[]').nullable(); // PostgreSQL array: ['action', 'drama']
    table.date('release_date').nullable();
    table.string('language', 50).nullable();

    // Status: active, coming_soon, inactive (soft-delete)
    table
      .string('status', 20)
      .notNullable()
      .defaultTo('active')
      .checkIn(
        ['active', 'coming_soon', 'inactive'],
        'ck_movies_status_valid',
      );

    // Timestamps UTC (D-18)
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Indexes for search & filtering
    table.index('status', 'idx_movies_status');
    table.index('title', 'idx_movies_title');
    table.index('release_date', 'idx_movies_release_date');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('movies');
}
