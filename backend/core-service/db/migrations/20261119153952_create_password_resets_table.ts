import type { Knex } from 'knex';

/**
 * ID-01 — Migration 5/5: core.password_resets
 * Owner: TV1 (Nguyễn Gia Khánh)
 *
 * Schema:
 *   password_resets { id UUID PK, user_id UUID FK, token_hash UNIQUE,
 *                     expires_at TIMESTAMPTZ, is_used BOOLEAN, consumed_at TIMESTAMPTZ NULL,
 *                     created_at TIMESTAMPTZ }
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('password_resets', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('core.users')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');

    table
      .string('token_hash', 255)
      .notNullable()
      .unique({ indexName: 'uq_password_resets_token_hash' });
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.boolean('is_used').notNullable().defaultTo(false);
    table.timestamp('consumed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index('user_id', 'idx_password_resets_user_id');
    table.index('expires_at', 'idx_password_resets_expires_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('password_resets');
}
