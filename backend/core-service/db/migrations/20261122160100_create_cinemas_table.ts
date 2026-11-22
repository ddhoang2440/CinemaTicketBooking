import type { Knex } from 'knex';

/**
 * CA-01 — Migration: core.cinemas
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * ERD: cinemas { id UUID PK, name, address, city, status }
 * Constraints: name + address indexed
 * Conventions: UUID PK, timestamptz UTC (D-18)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('cinemas', (table) => {
    // PK — UUID v4
    table
      .uuid('id')
      .primary()
      .defaultTo(knex.raw('uuid_generate_v4()'));

    // Core fields
    table.string('name', 255).notNullable();
    table.string('address', 500).notNullable();
    table.string('city', 100).notNullable();
    table.string('phone', 20).nullable();
    table.string('email', 255).nullable();

    // Status: active, inactive (soft-delete)
    table
      .string('status', 20)
      .notNullable()
      .defaultTo('active')
      .checkIn(['active', 'inactive'], 'ck_cinemas_status_valid');

    // Timestamps UTC (D-18)
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Indexes
    table.index(['name', 'address'], 'idx_cinemas_name_address');
    table.index('city', 'idx_cinemas_city');
    table.index('status', 'idx_cinemas_status');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('cinemas');
}
