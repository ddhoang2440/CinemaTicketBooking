import type { Knex } from 'knex';

const MIGRATION_NAME = '20261122161300_create_seat_holds_table';

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
    await knex.schema.withSchema('core').createTable('seat_holds', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('hold_group_id').notNullable();
      table.uuid('showtime_id').notNullable();
      table.uuid('auditorium_id').notNullable();
      table.uuid('seat_id').notNullable();
      table.string('status', 30).notNullable().defaultTo('active');
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign(['hold_group_id', 'showtime_id'], 'fk_seat_holds_group_showtime')
        .references(['id', 'showtime_id'])
        .inTable('core.seat_hold_groups')
        .onDelete('RESTRICT');
      table
        .foreign(['showtime_id', 'auditorium_id'], 'fk_seat_holds_showtime_auditorium')
        .references(['id', 'auditorium_id'])
        .inTable('core.showtimes')
        .onDelete('RESTRICT');
      table
        .foreign(['seat_id', 'auditorium_id'], 'fk_seat_holds_seat_auditorium')
        .references(['id', 'auditorium_id'])
        .inTable('core.seats')
        .onDelete('RESTRICT');

      table.unique(['hold_group_id', 'seat_id'], {
        indexName: 'uq_seat_holds_group_seat',
      });

      table.index(['hold_group_id'], 'idx_seat_holds_hold_group_id');
      table.index(['seat_id'], 'idx_seat_holds_seat_id');
    });

    await knex.raw(`
      ALTER TABLE core.seat_holds
        ADD CONSTRAINT chk_seat_holds_status
        CHECK (status IN ('active', 'confirmed', 'released', 'expired'))
    `);

    await knex.raw(`
      ALTER TABLE core.seat_holds
        ADD CONSTRAINT chk_seat_holds_expires_after_created
        CHECK (expires_at > created_at)
    `);

    await knex.raw(`
      CREATE UNIQUE INDEX uq_seat_hold_active
        ON core.seat_holds (showtime_id, seat_id)
        WHERE status = 'active'
    `);

    await knex.raw(`
      CREATE INDEX idx_seat_holds_showtime_active_expires
        ON core.seat_holds (showtime_id, expires_at)
        WHERE status = 'active'
    `);
  });
}

export async function down(knex: Knex): Promise<void> {
  const runLoggedMigration = await loadMigrationRunner();

  await runLoggedMigration(MIGRATION_NAME, 'down', async () => {
    await knex.schema.withSchema('core').dropTableIfExists('seat_holds');
  });
}
