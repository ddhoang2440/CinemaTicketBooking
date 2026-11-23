import type { Knex } from 'knex';

const MIGRATION_NAME = '20261122083200_create_seat_hold_groups_table';

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
    await knex.schema.withSchema('core').createTable('seat_hold_groups', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('showtime_id').notNullable();
      table.string('owner_ref', 255).notNullable();
      table.string('status', 30).notNullable().defaultTo('active');
      table.string('idempotency_key', 128).nullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('released_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('showtime_id', 'fk_seat_hold_groups_showtime')
        .references('id')
        .inTable('core.showtimes')
        .onDelete('RESTRICT');

      table.unique(['id', 'showtime_id'], {
        indexName: 'uq_seat_hold_groups_id_showtime',
      });

      table.index(['showtime_id'], 'idx_seat_hold_groups_showtime_id');
      table.index(['owner_ref', 'status'], 'idx_seat_hold_groups_owner_ref');
    });

    await knex.raw(`
      ALTER TABLE core.seat_hold_groups
        ADD CONSTRAINT chk_seat_hold_groups_status
        CHECK (status IN ('active', 'confirmed', 'released', 'expired'))
    `);

    await knex.raw(`
      ALTER TABLE core.seat_hold_groups
        ADD CONSTRAINT chk_seat_hold_groups_expires_after_created
        CHECK (expires_at > created_at)
    `);

    await knex.raw(`
      ALTER TABLE core.seat_hold_groups
        ADD CONSTRAINT chk_seat_hold_groups_released_after_created
        CHECK (released_at IS NULL OR released_at >= created_at)
    `);

    await knex.raw(`
      ALTER TABLE core.seat_hold_groups
        ADD CONSTRAINT chk_seat_hold_groups_owner_ref_nonempty
        CHECK (char_length(trim(owner_ref)) > 0)
    `);

    await knex.raw(`
      CREATE UNIQUE INDEX uq_hold_idempotency
        ON core.seat_hold_groups (owner_ref, idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);

    await knex.raw(`
      CREATE INDEX idx_seat_hold_groups_active_expires
        ON core.seat_hold_groups (expires_at)
        WHERE status = 'active'
    `);
  });
}

export async function down(knex: Knex): Promise<void> {
  const runLoggedMigration = await loadMigrationRunner();

  await runLoggedMigration(MIGRATION_NAME, 'down', async () => {
    await knex.schema.withSchema('core').dropTableIfExists('seat_hold_groups');
  });
}
