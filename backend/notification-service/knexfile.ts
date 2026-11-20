import 'dotenv/config';
import type { Knex } from 'knex';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://cinema_user:cinema_dev_password_placeholder@localhost:5432/cinema';
const dbSchema = process.env.DB_SCHEMA ?? 'notification';

/**
 * ACCEPTED — REVISED D-04: Shared PostgreSQL 17 instance with 3 isolated service schemas ("core", "payment", "notification").
 * This service owns and accesses only schema "notification".
 */
const config: Knex.Config = {
  client: 'pg',
  connection: databaseUrl,
  searchPath: [dbSchema],
  pool: {
    min: 1,
    max: 10,
  },
  migrations: {
    directory: './db/migrations',
    schemaName: dbSchema,
    tableName: 'knex_migrations',
    extension: 'ts',
  },
  seeds: {
    directory: './db/seeds',
    extension: 'ts',
  },
};

export default config;
