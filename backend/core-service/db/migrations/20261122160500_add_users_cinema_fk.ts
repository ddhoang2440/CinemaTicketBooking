import type { Knex } from 'knex';

/**
 * CA-01 — Migration 6/6: Add cinema_id FK to core.users and core.user_roles
 * Owner: TV2 (Nguyễn Bá Quốc Học), coordinated with TV1 (Nguyễn Gia Khánh)
 *
 * Why needed:
 *   - ERD §2.1: user_roles has cinema_id nullable (scoped role assignment for staff/manager).
 *   - TV1 also supports cinema_id on users table for staff/manager cinema assignment.
 *   - At the time TV1 migrations run (20261119*), core.cinemas does not exist yet.
 *   - Now that core.cinemas exists (20261122160100), we add the FK constraints safely.
 */
export async function up(knex: Knex): Promise<void> {
  const hasUsersTable = await knex.schema.withSchema('core').hasTable('users');
  if (hasUsersTable) {
    const hasCinemaIdCol = await knex.schema.withSchema('core').hasColumn('users', 'cinema_id');
    if (!hasCinemaIdCol) {
      await knex.schema.withSchema('core').alterTable('users', (table) => {
        table
          .uuid('cinema_id')
          .nullable()
          .references('id')
          .inTable('core.cinemas')
          .onDelete('SET NULL')
          .onUpdate('CASCADE')
          .comment('Assigned cinema for staff/manager roles; null for customers & admins');

        table.index('cinema_id', 'idx_users_cinema_id');
      });
    }
  }

  const hasUserRolesTable = await knex.schema.withSchema('core').hasTable('user_roles');
  if (hasUserRolesTable) {
    const fkCheck = await knex.raw(`
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'fk_user_roles_cinema'
        AND connamespace = 'core'::regnamespace
    `);
    if (fkCheck.rows.length === 0) {
      await knex.schema.withSchema('core').alterTable('user_roles', (table) => {
        table
          .foreign('cinema_id', 'fk_user_roles_cinema')
          .references('id')
          .inTable('core.cinemas')
          .onDelete('SET NULL')
          .onUpdate('CASCADE');
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasUserRolesTable = await knex.schema.withSchema('core').hasTable('user_roles');
  if (hasUserRolesTable) {
    const fkCheck = await knex.raw(`
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'fk_user_roles_cinema'
        AND connamespace = 'core'::regnamespace
    `);
    if (fkCheck.rows.length > 0) {
      await knex.schema.withSchema('core').alterTable('user_roles', (table) => {
        table.dropForeign(['cinema_id'], 'fk_user_roles_cinema');
      });
    }
  }

  const hasUsersTable = await knex.schema.withSchema('core').hasTable('users');
  if (hasUsersTable) {
    const hasCinemaIdCol = await knex.schema.withSchema('core').hasColumn('users', 'cinema_id');
    if (hasCinemaIdCol) {
      await knex.schema.withSchema('core').alterTable('users', (table) => {
        table.dropIndex('cinema_id', 'idx_users_cinema_id');
        table.dropColumn('cinema_id');
      });
    }
  }
}
