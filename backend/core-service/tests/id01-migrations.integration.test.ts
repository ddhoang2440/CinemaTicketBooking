import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory, { type Knex } from 'knex';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_IDS, seed as seedRoles } from '../db/seeds/00_roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

const ID01_MIGRATIONS = [
  '20261119153810_create_roles_table.ts',
  '20261119153918_create_users_table.ts',
  '20261119153935_create_email_verifications_table.ts',
  '20261119153944_create_refresh_tokens_table.ts',
  '20261119153952_create_password_resets_table.ts',
] as const;

const pgAdminUrl =
  process.env.ID01_TEST_DATABASE_URL ??
  process.env.SH01_TEST_DATABASE_URL ??
  process.env.BO01_TEST_DATABASE_URL;

function urlForDatabase(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

describe('ID-01 — Authentication & Role Migrations Static Verification (TV1)', () => {
  it.each(ID01_MIGRATIONS)(
    'migration %s uses explicit .withSchema("core"), gen_random_uuid(), and dropTableIfExists',
    (fileName) => {
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, fileName), 'utf-8');
      expect(content).toContain("withSchema('core')");
      expect(content).toContain('gen_random_uuid()');
      expect(content).toContain('dropTableIfExists');
      expect(content).not.toContain('increments(');
    },
  );

  it('00_roles.ts seed exports 4 canonical role UUIDs and uses idempotent onConflict upsert', () => {
    expect(Object.keys(ROLE_IDS)).toEqual(['customer', 'staff', 'manager', 'admin']);
    const seedContent = fs.readFileSync(
      path.resolve(__dirname, '../db/seeds/00_roles.ts'),
      'utf-8',
    );
    expect(seedContent).toContain(".onConflict('code')");
    expect(seedContent).not.toContain('.del()');
  });
});

describe.skipIf(!pgAdminUrl)('ID-01 PostgreSQL 17 Integration Verification (TV1)', () => {
  const dbName = `id01_int_${randomBytes(4).toString('hex')}`;
  let adminClient: pg.Client;
  let knex: Knex;

  beforeAll(async () => {
    adminClient = new pg.Client({ connectionString: pgAdminUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);

    knex = knexFactory({
      client: 'pg',
      connection: urlForDatabase(pgAdminUrl ?? '', dbName),
      searchPath: ['core', 'public'],
      pool: { min: 1, max: 4 },
    });

    await knex.raw('CREATE SCHEMA IF NOT EXISTS core');
    for (const file of ID01_MIGRATIONS) {
      const mod = (await import(path.join(MIGRATIONS_DIR, file))) as {
        up: (k: Knex) => Promise<void>;
      };
      await mod.up(knex);
    }
  }, 60_000);

  afterAll(async () => {
    await knex?.destroy();
    if (adminClient) {
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await adminClient.end();
    }
  }, 30_000);

  it('creates UUID primary keys and TIMESTAMPTZ columns across all auth tables in schema core', async () => {
    const pkCols = await knex.raw(`
      SELECT table_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'core'
        AND column_name = 'id'
        AND table_name IN (
          'roles',
          'users',
          'user_roles',
          'email_verifications',
          'refresh_sessions',
          'refresh_tokens',
          'password_resets'
        )
      ORDER BY table_name
    `);
    expect(pkCols.rows).toHaveLength(7);
    for (const row of pkCols.rows as Array<{ table_name: string; data_type: string }>) {
      expect(row.data_type, `${row.table_name}.id must be uuid`).toBe('uuid');
    }
  });

  it('seeds all 4 canonical roles idempotently without data loss on re-run', async () => {
    await seedRoles(knex);
    const first = await knex('core.roles').select('id', 'code', 'role_name').orderBy('code');
    expect(first.map((r) => r.code)).toEqual(['admin', 'customer', 'manager', 'staff']);

    // Re-run seed a second time
    await seedRoles(knex);
    const second = await knex('core.roles').select('id', 'code', 'role_name').orderBy('code');
    expect(second).toEqual(first);
  });

  it('enforces case-insensitive email uniqueness, user_roles scoping, and session rotation fields', async () => {
    await seedRoles(knex);

    const [user] = await knex('core.users')
      .insert({
        email: 'Khanh.Nguyen@Cinema.Local',
        password_hash: 'argon2id$hashed',
        full_name: 'Nguyễn Gia Khánh',
        role_id: ROLE_IDS.customer,
      })
      .returning('*');

    expect(user.id).toBeDefined();
    expect(user.status).toBe('active');
    expect(user.is_verified).toBe(false);

    // Reject duplicate email differing only in letter case
    await expect(
      knex('core.users').insert({
        email: 'khanh.nguyen@cinema.local',
        password_hash: 'argon2id$hashed2',
        full_name: 'Duplicate Case Email',
      }),
    ).rejects.toThrow();

    // Assign global customer role and cinema-scoped manager role in core.user_roles
    const cinemaId = randomUUID();
    await knex('core.user_roles').insert({
      user_id: user.id,
      role_id: ROLE_IDS.customer,
      cinema_id: null,
    });
    await expect(
      knex('core.user_roles').insert({
        user_id: user.id,
        role_id: ROLE_IDS.customer,
        cinema_id: null,
      }),
    ).rejects.toThrow();

    await knex('core.user_roles').insert({
      user_id: user.id,
      role_id: ROLE_IDS.manager,
      cinema_id: cinemaId,
    });

    // Verify refresh_sessions rotation fields (revoked_at, rotated_from)
    const [firstSession] = await knex('core.refresh_sessions')
      .insert({
        user_id: user.id,
        token_hash: 'sha256:session-token-1',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .returning('*');

    const [rotatedSession] = await knex('core.refresh_sessions')
      .insert({
        user_id: user.id,
        token_hash: 'sha256:session-token-2',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        rotated_from: firstSession.id,
      })
      .returning('*');

    expect(rotatedSession.rotated_from).toBe(firstSession.id);

    // Verify email_verifications & password_resets consumed_at fields
    const [verification] = await knex('core.email_verifications')
      .insert({
        user_id: user.id,
        token_hash: 'sha256:email-verify-1',
        expires_at: new Date(Date.now() + 900_000).toISOString(),
        is_used: true,
        consumed_at: new Date().toISOString(),
      })
      .returning('*');
    expect(verification.consumed_at).toBeTruthy();

    const [reset] = await knex('core.password_resets')
      .insert({
        user_id: user.id,
        token_hash: 'sha256:pwd-reset-1',
        expires_at: new Date(Date.now() + 900_000).toISOString(),
        is_used: true,
        consumed_at: new Date().toISOString(),
      })
      .returning('*');
    expect(reset.consumed_at).toBeTruthy();
  });

  it('rolls back all ID-01 migrations cleanly and re-applies them', async () => {
    for (const file of [...ID01_MIGRATIONS].reverse()) {
      const mod = (await import(path.join(MIGRATIONS_DIR, file))) as {
        down: (k: Knex) => Promise<void>;
      };
      await mod.down(knex);
    }

    const remaining = await knex.raw(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'core'
        AND table_name IN (
          'roles',
          'users',
          'user_roles',
          'email_verifications',
          'refresh_sessions',
          'refresh_tokens',
          'password_resets'
        )
    `);
    expect(remaining.rows).toHaveLength(0);

    for (const file of ID01_MIGRATIONS) {
      const mod = (await import(path.join(MIGRATIONS_DIR, file))) as {
        up: (k: Knex) => Promise<void>;
      };
      await mod.up(knex);
    }
    await seedRoles(knex);
    const roles = await knex('core.roles');
    expect(roles).toHaveLength(4);
  });
});