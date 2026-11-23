import type { Knex } from 'knex';

const MIGRATION_NAME = '20261122161100_create_ticket_prices_table';

type MigrationRunner = (
  migrationName: string,
  direction: 'up' | 'down',
  fn: () => Promise<void>,
) => Promise<void>;

async function loadMigrationRunner(): Promise<MigrationRunner> {
  try {
    const mod = (await import('../utils/migration-logger.js')) as {
      runLoggedMigration: MigrationRunner;
    };
    return mod.runLoggedMigration;
  } catch {
    const tsUrl = new URL('../utils/migration-logger.ts', import.meta.url).href;
    const mod = (await import(tsUrl)) as {
      runLoggedMigration: MigrationRunner;
    };
    return mod.runLoggedMigration;
  }
}

export async function up(knex: Knex): Promise<void> {
  const runLoggedMigration = await loadMigrationRunner();

  await runLoggedMigration(MIGRATION_NAME, 'up', async () => {
    await knex.schema.withSchema('core').createTable('ticket_prices', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('showtime_id').notNullable();
      table.string('seat_type', 20).notNullable();
      table.bigInteger('amount_vnd').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('showtime_id', 'fk_ticket_prices_showtime')
        .references('id')
        .inTable('core.showtimes')
        .onDelete('RESTRICT');

      table.unique(['showtime_id', 'seat_type'], {
        indexName: 'uq_ticket_prices_showtime_seat_type',
      });
      table.index(['showtime_id'], 'idx_ticket_prices_showtime_id');
    });

    await knex.raw(`
      ALTER TABLE core.ticket_prices
        ADD CONSTRAINT chk_ticket_prices_seat_type
        CHECK (seat_type IN ('standard', 'vip', 'couple'))
    `);

    await knex.raw(`
      ALTER TABLE core.ticket_prices
        ADD CONSTRAINT chk_ticket_prices_amount_nonnegative
        CHECK (amount_vnd >= 0)
    `);
  });
}

export async function down(knex: Knex): Promise<void> {
  const runLoggedMigration = await loadMigrationRunner();

  await runLoggedMigration(MIGRATION_NAME, 'down', async () => {
    await knex.schema.withSchema('core').dropTableIfExists('ticket_prices');
  });
}
