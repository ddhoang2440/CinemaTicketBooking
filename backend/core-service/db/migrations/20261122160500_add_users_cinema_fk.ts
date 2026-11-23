import type { Knex } from 'knex';

/**
 * CA-01 — Migration: Add FK from users.cinema_id → cinemas.id
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * The users table was created by TV1 with cinema_id as nullable integer
 * but the FK reference was commented out pending cinemas table creation.
 * Now that cinemas exists (with UUID PK), we need to:
 * 1. Change cinema_id column type from integer to uuid
 * 2. Add the proper FK constraint
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    // Drop the old integer cinema_id column
    table.dropColumn('cinema_id');
  });

  await knex.schema.alterTable('users', (table) => {
    // Re-add as UUID with proper FK reference to cinemas
    table
      .uuid('cinema_id')
      .nullable()
      .references('id')
      .inTable('cinemas')
      .onDelete('SET NULL')
      .onUpdate('CASCADE');

    table.index('cinema_id', 'idx_users_cinema_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('cinema_id');
  });

  await knex.schema.alterTable('users', (table) => {
    table.integer('cinema_id').nullable();
  });
}
