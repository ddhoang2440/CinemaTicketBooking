import type { Knex } from 'knex';

/**
 * CA-01 — Migration 2/6: core.cinemas
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * ERD: cinemas { id UUID PK, name, address, city, status }
 * Constraints: name + address indexed, status IN ('active', 'inactive', 'maintenance')
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('cinemas', (table) => {
    table
      .uuid('id')
      .primary()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table.string('name', 255).notNullable();
    table.string('address', 500).notNullable();
    table.string('city', 100).notNullable();
    table
      .string('status', 20)
      .notNullable()
      .defaultTo('active')
      .comment('active | inactive | maintenance');

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Indexes per ERD: name + address indexed, plus city & status for filtering
    table.index(['name', 'address'], 'idx_cinemas_name_address');
    table.index('city', 'idx_cinemas_city');
    table.index('status', 'idx_cinemas_status');
  });

  await knex.raw(`
    ALTER TABLE core.cinemas
      ADD CONSTRAINT chk_cinemas_status
        CHECK (status IN ('active', 'inactive', 'maintenance'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('cinemas');
}
