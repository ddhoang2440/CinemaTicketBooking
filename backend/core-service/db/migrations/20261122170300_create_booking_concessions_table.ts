import type { Knex } from 'knex';

/**
 * BO-01 — Migration: core.booking_concessions
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * ERD: booking_concessions { id UUID PK, booking_id FK, concession_id FK, quantity, unit_price_vnd }
 * Constraints: quantity > 0, unit_price_vnd >= 0, unique(booking_id, concession_id)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').createTable('booking_concessions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('booking_id').notNullable();
    table.uuid('concession_id').notNullable();
    table.integer('quantity').notNullable();
    table.bigInteger('unit_price_vnd').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('booking_id', 'fk_booking_concessions_booking')
      .references('id')
      .inTable('core.bookings')
      .onDelete('RESTRICT');
    table
      .foreign('concession_id', 'fk_booking_concessions_concession')
      .references('id')
      .inTable('core.concessions')
      .onDelete('RESTRICT');
    table.unique(['booking_id', 'concession_id'], {
      indexName: 'uq_booking_concessions_booking_concession',
    });
  });

  await knex.raw(`
    ALTER TABLE core.booking_concessions
      ADD CONSTRAINT chk_booking_concessions_quantity_positive CHECK (quantity > 0),
      ADD CONSTRAINT chk_booking_concessions_unit_price_nonnegative CHECK (unit_price_vnd >= 0)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('core').dropTableIfExists('booking_concessions');
}
