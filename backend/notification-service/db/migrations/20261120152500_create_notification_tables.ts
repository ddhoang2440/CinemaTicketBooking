import type { Knex } from 'knex';

/**
 * TV5 — Notification Schema Migrations (OP-02 / SCRUM-22)
 * Schema: notification
 * Tables: notification.notification_templates, notification.notification_deliveries
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS notification');

  // 1. notification.notification_templates
  await knex.schema.withSchema('notification').createTable('notification_templates', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .string('code', 100)
      .notNullable()
      .unique({ indexName: 'uq_notification_templates_code' });
    table.text('subject_template').notNullable();
    table.text('body_template').notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // 2. notification.notification_deliveries
  await knex.schema.withSchema('notification').createTable('notification_deliveries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .string('idempotency_key', 255)
      .notNullable()
      .unique({ indexName: 'uq_notification_idempotency' });
    table
      .string('template_code', 100)
      .notNullable()
      .references('code')
      .inTable('notification.notification_templates')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
    table.string('recipient_email', 255).notNullable();
    table.uuid('booking_id').nullable();
    table.uuid('payment_id').nullable();
    table.jsonb('payload').notNullable().defaultTo('{}');
    table.string('status', 20).notNullable().defaultTo('queued');
    table.integer('attempt_count').notNullable().defaultTo(0);
    table.string('provider_message_id', 255).nullable();
    table.text('last_error').nullable();
    table.timestamp('sent_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['template_code'], 'idx_notification_deliveries_template_code');
    table.index(['recipient_email'], 'idx_notification_deliveries_recipient');
    table.index(['booking_id'], 'idx_notification_deliveries_booking');
    table.index(['status'], 'idx_notification_deliveries_status');
  });

  await knex.raw(`
    ALTER TABLE notification.notification_deliveries
      ADD CONSTRAINT chk_notification_deliveries_status
        CHECK (status IN ('queued', 'sent', 'failed')),
      ADD CONSTRAINT chk_notification_deliveries_attempt_count_nonnegative
        CHECK (attempt_count >= 0)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('notification').dropTableIfExists('notification_deliveries');
  await knex.schema.withSchema('notification').dropTableIfExists('notification_templates');
}
