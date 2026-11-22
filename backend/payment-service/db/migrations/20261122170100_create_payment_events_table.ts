import type { Knex } from 'knex';

/**
 * BO-01 — Migration: payment.payment_events
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * ERD: payment_events { id UUID PK, provider_event_id, payment_id FK, event_type, received_at }
 * Constraints: unique(provider_event_id) (webhook replay/idempotency, D-09),
 *              event_type IN (succeeded, failed)
 * Notes: only signature-verified events are stored, so there is no signature_valid column.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('payment').createTable('payment_events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('provider_event_id', 255).notNullable();
    table.uuid('payment_id').notNullable();
    table.string('event_type', 30).notNullable();
    table.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('payment_id', 'fk_payment_events_payment')
      .references('id')
      .inTable('payment.payments')
      .onDelete('RESTRICT');
    table.unique(['provider_event_id'], { indexName: 'uq_payment_provider_event' });
    table.index(['payment_id'], 'idx_payment_events_payment_id');
  });

  await knex.raw(
    "ALTER TABLE payment.payment_events ADD CONSTRAINT chk_payment_events_event_type CHECK (event_type IN ('succeeded','failed'))",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('payment').dropTableIfExists('payment_events');
}
