import type { Knex } from 'knex';

/**
 * TV5 — Notification Schema Migrations
 * Tables: notification_templates, notification_deliveries
 */
export async function up(knex: Knex): Promise<void> {
  // 1. notification_templates
  await knex.schema.createTable('notification_templates', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('code', 100).notNullable().unique();
    table.text('subject_template').notNullable();
    table.text('body_template').notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  // 2. notification_deliveries
  await knex.schema.createTable('notification_deliveries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('idempotency_key', 255).notNullable().unique();
    table.string('template_code', 100).notNullable();
    table.string('recipient_email', 255).notNullable();
    table.uuid('booking_id').nullable();
    table.uuid('payment_id').nullable();
    table.jsonb('payload').notNullable().defaultTo('{}');
    table.string('status', 20).notNullable().defaultTo('queued'); // 'queued' | 'sent' | 'failed'
    table.integer('attempt_count').notNullable().defaultTo(0);
    table.text('last_error').nullable();
    table.timestamp('sent_at', { useTz: true }).nullable();
    table.timestamps(true, true);

    table.index(['recipient_email'], 'idx_notification_deliveries_recipient');
    table.index(['booking_id'], 'idx_notification_deliveries_booking');
    table.index(['status'], 'idx_notification_deliveries_status');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notification_deliveries');
  await knex.schema.dropTableIfExists('notification_templates');
}
