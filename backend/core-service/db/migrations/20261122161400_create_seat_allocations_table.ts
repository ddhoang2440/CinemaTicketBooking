import type { Knex } from 'knex';

const MIGRATION_NAME = '20261122161400_create_seat_allocations_table';

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
    await knex.schema.withSchema('core').createTable('seat_allocations', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('showtime_id').notNullable();
      table.uuid('auditorium_id').notNullable();
      table.uuid('seat_id').notNullable();
      // Deferred FK to core.bookings(id): added by BO-01 after core.bookings is created
      // to avoid a circular dependency with bookings.hold_group_id -> core.seat_hold_groups(id).
      table.uuid('booking_id').notNullable();
      table.uuid('hold_group_id').nullable();
      table.string('status', 30).notNullable().defaultTo('active');
      table.timestamp('confirmed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('cancelled_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign(['showtime_id', 'auditorium_id'], 'fk_seat_allocations_showtime_auditorium')
        .references(['id', 'auditorium_id'])
        .inTable('core.showtimes')
        .onDelete('RESTRICT');
      table
        .foreign(['seat_id', 'auditorium_id'], 'fk_seat_allocations_seat_auditorium')
        .references(['id', 'auditorium_id'])
        .inTable('core.seats')
        .onDelete('RESTRICT');
      table
        .foreign(['hold_group_id', 'showtime_id'], 'fk_seat_allocations_hold_group_showtime')
        .references(['id', 'showtime_id'])
        .inTable('core.seat_hold_groups')
        .onDelete('RESTRICT');

      table.index(['booking_id'], 'idx_seat_allocations_booking_id');
      table.index(['showtime_id'], 'idx_seat_allocations_showtime_id');
      table.index(['seat_id'], 'idx_seat_allocations_seat_id');
    });

    await knex.raw(`
      ALTER TABLE core.seat_allocations
        ADD CONSTRAINT chk_seat_allocations_status
        CHECK (status IN ('active', 'cancelled'))
    `);

    await knex.raw(`
      ALTER TABLE core.seat_allocations
        ADD CONSTRAINT chk_seat_allocations_cancelled_after_confirmed
        CHECK (cancelled_at IS NULL OR cancelled_at >= confirmed_at)
    `);

    await knex.raw(`
      ALTER TABLE core.seat_allocations
        ADD CONSTRAINT chk_seat_allocations_status_cancelled_at
        CHECK (
          (status = 'active' AND cancelled_at IS NULL)
          OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
        )
    `);

    await knex.raw(`
      CREATE UNIQUE INDEX uq_seat_allocation_active
        ON core.seat_allocations (showtime_id, seat_id)
        WHERE status = 'active'
    `);

    await knex.raw(`
      CREATE INDEX idx_seat_allocations_hold_group_id
        ON core.seat_allocations (hold_group_id)
        WHERE hold_group_id IS NOT NULL
    `);
  });
}

export async function down(knex: Knex): Promise<void> {
  const runLoggedMigration = await loadMigrationRunner();

  await runLoggedMigration(MIGRATION_NAME, 'down', async () => {
    await knex.schema.withSchema('core').dropTableIfExists('seat_allocations');
  });
}
