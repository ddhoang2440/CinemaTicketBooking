import 'dotenv/config';
import type { Knex } from 'knex';
import { env } from './src/config/env.js';

/**
 * ACCEPTED — REVISED D-04: Shared PostgreSQL 17 instance with 3 isolated service schemas ("core", "payment", "notification").
 * This service owns and accesses only schema "core".
 */
const config: Knex.Config = {
  client: 'pg',
  connection: env.DATABASE_URL,
  searchPath: [env.DB_SCHEMA],
  pool: {
    min: 1,
    max: 10,
  },
  migrations: {
    directory: './db/migrations',
    schemaName: env.DB_SCHEMA,
    tableName: 'knex_migrations',
    extension: 'ts',
  },
  seeds: {
    directory: './db/seeds',
    extension: 'ts',
  },
};

export default config;
