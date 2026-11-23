import type { Knex } from 'knex';

/**
 * ID-01 — Migration 2/5: core.users & core.user_roles
 * Owner: TV1 (Nguyễn Gia Khánh)
 *
 * ERD §1 & §2.1:
 *   users { id UUID PK, email, password_hash, full_name, phone, status, is_verified,
 *           verified_at, role_id nullable FK, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ }
 *   user_roles { id UUID PK, user_id FK, role_id FK, cinema_id nullable,
 *                created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ }
 *
 * Constraints:
 *   - Case-insensitive unique email index uq_users_email_lower ON core.users (LOWER(email))
 *   - status IN ('active', 'pending', 'locked', 'disabled')
 *   - Unique scoped association on user_roles (global when cinema_id IS NULL, or per cinema_id)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email', 255).notNullable().unique({ indexName: 'uq_users_email' });
    table.string('password_hash', 255).notNullable();
    table.string('full_name', 100).notNullable();
    table.string('phone', 20).nullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.boolean('is_verified').notNullable().defaultTo(false);
    table.timestamp('verified_at', { useTz: true }).nullable();

    table
      .uuid('role_id')
      .nullable()
      .references('id')
      .inTable('core.roles')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index('role_id', 'idx_users_role_id');
    table.index('status', 'idx_users_status');
  });

  await knex.raw(`
    ALTER TABLE core.users
      ADD CONSTRAINT chk_users_status
        CHECK (status IN ('active', 'pending', 'locked', 'disabled'))
  `);

  // Case-insensitive email uniqueness per ERD §2.1 ("unique normalized email")
  await knex.raw(`
    CREATE UNIQUE INDEX uq_users_email_lower
      ON core.users (LOWER(email))
  `);

  // Scoped user_roles association table per ERD §2.1 & erd-detailed.mmd
  await knex.schema.withSchema('core').createTable('user_roles', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('core.users')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');
    table
      .uuid('role_id')
      .notNullable()
      .references('id')
      .inTable('core.roles')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
    // FK to core.cinemas(id) is added in 20261122160500_add_users_cinema_fk.ts after cinemas table is created
    table.uuid('cinema_id').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index('user_id', 'idx_user_roles_user_id');
    table.index('role_id', 'idx_user_roles_role_id');
    table.index('cinema_id', 'idx_user_roles_cinema_id');
  });

  await knex.raw(`
    CREATE UNIQUE INDEX uq_user_roles_global
      ON core.user_roles (user_id, role_id)
      WHERE cinema_id IS NULL;

    CREATE UNIQUE INDEX uq_user_roles_scoped
      ON core.user_roles (user_id, role_id, cinema_id)
      WHERE cinema_id IS NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('user_roles');
  await knex.schema.withSchema('core').dropTableIfExists('users');
}
