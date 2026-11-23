import type { Knex } from 'knex';

const MIGRATION_NAME = '20261122161000_create_showtimes_table';

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
    await knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gist');

    await knex.schema.withSchema('core').createTable('showtimes', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('movie_id').notNullable();
      table.uuid('cinema_id').notNullable();
      table.uuid('auditorium_id').notNullable();
      table.timestamp('starts_at', { useTz: true }).notNullable();
      table.timestamp('ends_at', { useTz: true }).notNullable();
      table.string('format', 10).notNullable();
      table.string('state', 20).notNullable().defaultTo('draft');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('movie_id', 'fk_showtimes_movie')
        .references('id')
        .inTable('core.movies')
        .onDelete('RESTRICT');
      table
        .foreign('cinema_id', 'fk_showtimes_cinema')
        .references('id')
        .inTable('core.cinemas')
        .onDelete('RESTRICT');
      table
        .foreign(['auditorium_id', 'cinema_id'], 'fk_showtimes_auditorium_cinema')
        .references(['id', 'cinema_id'])
        .inTable('core.auditoriums')
        .onDelete('RESTRICT');

      table.unique(['id', 'auditorium_id'], { indexName: 'uq_showtimes_id_auditorium' });

      table.index(['cinema_id', 'starts_at', 'state'], 'idx_showtime_filter');
      table.index(['movie_id'], 'idx_showtimes_movie_id');
      table.index(['auditorium_id'], 'idx_showtimes_auditorium_id');
      table.index(['starts_at'], 'idx_showtimes_starts_at');
    });

    await knex.raw(`
      ALTER TABLE core.showtimes
        ADD CONSTRAINT chk_showtimes_time_order
        CHECK (ends_at > starts_at)
    `);

    await knex.raw(`
      ALTER TABLE core.showtimes
        ADD CONSTRAINT chk_showtimes_format
        CHECK (format IN ('2D', '3D', 'IMAX'))
    `);

    await knex.raw(`
      ALTER TABLE core.showtimes
        ADD CONSTRAINT chk_showtimes_state
        CHECK (state IN ('draft', 'on_sale', 'sales_paused', 'started', 'completed', 'cancelled'))
    `);

    // PG 17 requires IMMUTABLE expressions inside GiST exclusion indexes;
    // timestamptz + interval is STABLE, so add the 15-minute buffer in UTC timestamp.
    await knex.raw(`
      ALTER TABLE core.showtimes
        ADD CONSTRAINT showtime_no_room_overlap
        EXCLUDE USING gist (
          auditorium_id WITH =,
          tstzrange(
            starts_at,
            timezone(interval '0', (ends_at AT TIME ZONE 'UTC') + interval '15 minutes'),
            '[)'
          ) WITH &&
        )
        WHERE (state IN ('draft', 'on_sale', 'sales_paused', 'started'))
    `);
  });
}

export async function down(knex: Knex): Promise<void> {
  const runLoggedMigration = await loadMigrationRunner();

  await runLoggedMigration(MIGRATION_NAME, 'down', async () => {
    await knex.schema.withSchema('core').dropTableIfExists('showtimes');
  });
}
