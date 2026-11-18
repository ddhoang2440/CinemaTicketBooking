import knex, { type Knex } from 'knex';
import { env } from './env.js';

let dbInstance: Knex | null = null;

/**
 * Returns the Knex configuration scoped strictly to the "core" schema (D-04 Revised).
 */
export function getDbConfig(): Knex.Config {
  return {
    client: 'pg',
    connection: env.DATABASE_URL,
    searchPath: [env.DB_SCHEMA],
    pool: {
      min: 0,
      max: 10,
    },
  };
}

export function getDb(): Knex {
  if (!dbInstance) {
    dbInstance = knex(getDbConfig());
  }
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
  }
}
