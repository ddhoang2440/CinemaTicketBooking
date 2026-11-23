import type { Knex } from 'knex';

/**
 * ID-01 — Migration 3/5: core.email_verifications
 * Owner: TV1 (Nguyễn Gia Khánh)
 *
 * ERD §1 & §2.1:
 *   email_verifications { id UUID PK, user_id UUID FK, token_hash UNIQUE,
 *                         expires_at TIMESTAMPTZ, is_used BOOLEAN, consumed_at TIMESTAMPTZ,
 *                         created_at TIMESTAMPTZ }
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('email_verifications', (table) => {
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
      .unique({ indexName: 'uq_email_verifications_token_hash' });
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.boolean('is_used').notNullable().defaultTo(false);
    table.timestamp('consumed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index('user_id', 'idx_email_verifications_user_id');
    table.index('expires_at', 'idx_email_verifications_expires_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('email_verifications');
}
