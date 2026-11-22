import type { Knex } from 'knex';

/**
 * BO-01 — Migration: core.concessions
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * ERD: concessions { id UUID PK, name, unit_price_vnd, is_available }
 * Constraints: unit_price_vnd >= 0
 * Conventions: UUID PK, integer VND BIGINT + timestamptz UTC (D-18), hide via is_available (no delete)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('concessions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 100).notNullable();
    table.bigInteger('unit_price_vnd').notNullable();
    table.boolean('is_available').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    'ALTER TABLE core.concessions ADD CONSTRAINT chk_concessions_unit_price_nonnegative CHECK (unit_price_vnd >= 0)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('concessions');
}
