import type { Knex } from 'knex';

/**
 * CA-01 — Migration: core.auditoriums
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * ERD: auditoriums { id UUID PK, cinema_id FK, name, supported_formats, status }
 * Constraints: unique(cinema_id, name)
 * Conventions: UUID PK, timestamptz UTC (D-18)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('auditoriums', (table) => {
    // PK — UUID v4
    table
      .uuid('id')
      .primary()
      .defaultTo(knex.raw('uuid_generate_v4()'));

    // FK to cinemas
    table
      .uuid('cinema_id')
      .notNullable()
      .references('id')
      .inTable('cinemas')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');

    // Core fields
    table.string('name', 100).notNullable(); // e.g., "Phòng 1", "IMAX Hall"

    // Supported screening formats: PostgreSQL array ['2D', '3D', 'IMAX']
    table
      .specificType('supported_formats', 'text[]')
      .notNullable()
      .defaultTo(knex.raw("ARRAY['2D']"));

    // Capacity (derived from seat count, stored for quick filtering)
    table.integer('total_seats').notNullable().defaultTo(0);

    // Status: active, maintenance, inactive (soft-delete)
    table
      .string('status', 20)
      .notNullable()
      .defaultTo('active')
      .checkIn(
        ['active', 'maintenance', 'inactive'],
        'ck_auditoriums_status_valid',
      );

    // Timestamps UTC (D-18)
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Constraints
    table.unique(['cinema_id', 'name'], {
      indexName: 'uq_auditoriums_cinema_name',
    });

    // Indexes (FK index for cinema_id)
    table.index('cinema_id', 'idx_auditoriums_cinema_id');
    table.index('status', 'idx_auditoriums_status');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auditoriums');
}
