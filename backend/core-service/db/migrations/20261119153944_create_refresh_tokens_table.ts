import type { Knex } from 'knex';

/**
 * ID-01 — Migration 4/5: core.refresh_sessions & core.refresh_tokens
 * Owner: TV1 (Nguyễn Gia Khánh)
 *
 * ERD §1 & §2.1:
 *   refresh_sessions { id UUID PK, user_id UUID FK, token_hash UNIQUE,
 *                      expires_at TIMESTAMPTZ, is_revoked BOOLEAN,
 *                      revoked_at TIMESTAMPTZ NULL, rotated_from UUID NULL FK,
 *                      created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ }
 *
 * Provides both core.refresh_sessions (ERD canonical table) and core.refresh_tokens
 * (legacy table name) with identical session-rotation schema and FK indexes.
 */
function buildRefreshSessionColumns(knex: Knex, table: Knex.CreateTableBuilder, prefix: string): void {
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
    .unique({ indexName: `uq_${prefix}_token_hash` });
  table.timestamp('expires_at', { useTz: true }).notNullable();
  table.boolean('is_revoked').notNullable().defaultTo(false);
  table.timestamp('revoked_at', { useTz: true }).nullable();

  table
    .uuid('rotated_from')
    .nullable()
    .references('id')
    .inTable(`core.${prefix}`)
    .onDelete('SET NULL')
    .onUpdate('CASCADE');

  table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

  table.index('user_id', `idx_${prefix}_user_id`);
  table.index('rotated_from', `idx_${prefix}_rotated_from`);
  table.index('expires_at', `idx_${prefix}_expires_at`);
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('refresh_sessions', (table) => {
    buildRefreshSessionColumns(knex, table, 'refresh_sessions');
  });

  await knex.schema.withSchema('core').createTable('refresh_tokens', (table) => {
    buildRefreshSessionColumns(knex, table, 'refresh_tokens');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('refresh_tokens');
  await knex.schema.withSchema('core').dropTableIfExists('refresh_sessions');
}
