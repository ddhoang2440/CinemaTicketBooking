import type { Knex } from 'knex';

/**
 * ID-01 — Migration 1/5: core.roles
 * Owner: TV1 (Nguyễn Gia Khánh)
 *
 * ERD §1 & §2.1:
 *   roles { id UUID PK, code ('customer' | 'staff' | 'manager' | 'admin') UNIQUE,
 *           role_name UNIQUE, description, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ }
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS core');

  await knex.schema.withSchema('core').createTable('roles', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('code', 50).notNullable().unique({ indexName: 'uq_roles_code' });
    table.string('role_name', 50).notNullable().unique({ indexName: 'uq_roles_role_name' });
    table.string('description', 255).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE core.roles
      ADD CONSTRAINT chk_roles_code
        CHECK (code IN ('customer', 'staff', 'manager', 'admin'))
  `);

  // Synchronize code and role_name automatically when callers provide either column
  await knex.raw(`
    CREATE OR REPLACE FUNCTION core.fn_sync_roles_code_name()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.code IS NULL AND NEW.role_name IS NOT NULL THEN
        NEW.code := LOWER(TRIM(NEW.role_name));
      ELSIF NEW.role_name IS NULL AND NEW.code IS NOT NULL THEN
        NEW.role_name := LOWER(TRIM(NEW.code));
      ELSE
        NEW.code := LOWER(TRIM(NEW.code));
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_roles_sync_code_name
      BEFORE INSERT OR UPDATE ON core.roles
      FOR EACH ROW
      EXECUTE FUNCTION core.fn_sync_roles_code_name();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('roles');
  await knex.raw('DROP FUNCTION IF EXISTS core.fn_sync_roles_code_name() CASCADE');
}
