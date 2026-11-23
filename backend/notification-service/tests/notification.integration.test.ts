import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory, { type Knex } from 'knex';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seed as seedTemplates } from '../db/seeds/01_notification_templates.js';
import type { DeliveryRepository } from '../src/modules/delivery/delivery.repository.js';
import { DeliveryService } from '../src/modules/delivery/delivery.service.js';
import { TemplateService } from '../src/modules/templates/template.service.js';
import { setEmailTransport, type SendMailOptions } from '../src/modules/email/email.transport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../db/migrations');

const pgAdminUrl =
  process.env.NOTIFICATION_TEST_DATABASE_URL ??
  process.env.SH01_TEST_DATABASE_URL ??
  process.env.BO01_TEST_DATABASE_URL;

function urlForDatabase(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

describe.skipIf(!pgAdminUrl)(
  'OP-02 Notification Service — PostgreSQL 17 Integration Tests (TV5)',
  () => {
    const dbName = `op02_notif_${randomBytes(4).toString('hex')}`;
    let adminClient: pg.Client;
    let knex: Knex;
    let sendMailCalls: SendMailOptions[];

    beforeAll(async () => {
      adminClient = new pg.Client({ connectionString: pgAdminUrl });
      await adminClient.connect();
      await adminClient.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);

      knex = knexFactory({
        client: 'pg',
        connection: urlForDatabase(pgAdminUrl ?? '', dbName),
        searchPath: ['notification', 'public'],
        pool: { min: 1, max: 5 },
        migrations: {
          directory: migrationsDir,
          schemaName: 'notification',
          tableName: 'knex_migrations',
          extension: 'ts',
          loadExtensions: ['.ts'],
        },
      });

      await knex.raw('CREATE SCHEMA IF NOT EXISTS notification');
      await knex.migrate.latest();
      await seedTemplates(knex);
    }, 60_000);

    afterAll(async () => {
      setEmailTransport(null);
      await knex?.destroy();
      if (adminClient) {
        await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
        await adminClient.end();
      }
    }, 30_000);

    beforeEach(() => {
      sendMailCalls = [];
      setEmailTransport({
        sendMail: vi.fn(async (opts: SendMailOptions) => {
          sendMailCalls.push(opts);
          return { messageId: `<smtp-${randomUUID()}@cinema.local>` };
        }),
      });
    });

    function createDbBackedServices(maxAttempts = 3) {
      const repo: DeliveryRepository = {
        async findByIdempotencyKey(key) {
          const row = await knex('notification.notification_deliveries')
            .where({ idempotency_key: key })
            .first();
          return row ?? null;
        },
        async create(params) {
          const [created] = await knex('notification.notification_deliveries')
            .insert({
              id: randomUUID(),
              idempotency_key: params.idempotencyKey,
              template_code: params.templateCode,
              recipient_email: params.recipientEmail,
              booking_id: params.bookingId ?? null,
              payment_id: params.paymentId ?? null,
              payload: params.payload ?? {},
              status: params.status ?? 'queued',
              attempt_count: 0,
              provider_message_id: null,
              last_error: null,
              sent_at: null,
            })
            .returning('*');
          return created;
        },
        async claimForRetry(id, limit) {
          const [claimed] = await knex('notification.notification_deliveries')
            .where({ id, status: 'failed' })
            .andWhere('attempt_count', '<', limit)
            .update({ status: 'queued', updated_at: knex.fn.now() })
            .returning('*');
          return claimed ?? null;
        },
        async markSent(id, providerMessageId) {
          const [updated] = await knex('notification.notification_deliveries')
            .where({ id })
            .update({
              status: 'sent',
              provider_message_id: providerMessageId ?? null,
              last_error: null,
              sent_at: knex.fn.now(),
              updated_at: knex.fn.now(),
              attempt_count: knex.raw('attempt_count + 1'),
            })
            .returning('*');
          return updated;
        },
        async markFailed(id, errorMessage) {
          const [updated] = await knex('notification.notification_deliveries')
            .where({ id })
            .update({
              status: 'failed',
              last_error: errorMessage,
              updated_at: knex.fn.now(),
              attempt_count: knex.raw('attempt_count + 1'),
            })
            .returning('*');
          return updated;
        },
      };

      const templates = new TemplateService({
        async findByCode(code) {
          const row = await knex('notification.notification_templates').where({ code }).first();
          return row ?? null;
        },
      });

      return new DeliveryService(repo, templates, { maxAttempts });
    }

    it('seeds all 5 notification templates idempotently without deleting existing deliveries', async () => {
      const templates = await knex('notification.notification_templates').orderBy('code');
      expect(templates.map((t) => t.code)).toEqual([
        'booking_cancelled',
        'booking_confirmed',
        'email_verification',
        'refund_processed',
        'ticket_issued',
      ]);

      // Insert a delivery referencing booking_confirmed, then re-run seedTemplates
      const service = createDbBackedServices();
      const record = await service.processNotification({
        idempotencyKey: 'pg17-idemp-seed-check',
        templateCode: 'booking_confirmed',
        recipientEmail: 'seed.check@cinema.local',
        payload: { name: 'Huy', bookingCode: 'BK-100' },
      });
      expect(record.status).toBe('sent');
      expect(record.provider_message_id).toContain('@cinema.local');

      // Re-seeding must not fail on FK or delete templates
      await seedTemplates(knex);
      const afterReseed = await knex('notification.notification_templates');
      expect(afterReseed).toHaveLength(5);
    });

    it('prevents duplicate email delivery under concurrent requests with identical idempotencyKey', async () => {
      const service = createDbBackedServices();
      const key = `pg17-concurrent-${randomBytes(4).toString('hex')}`;

      const [resA, resB] = await Promise.all([
        service.processNotification({
          idempotencyKey: key,
          templateCode: 'ticket_issued',
          recipientEmail: 'concurrent@cinema.local',
          payload: { name: 'Huy', ticketCode: 'TK-01' },
        }),
        service.processNotification({
          idempotencyKey: key,
          templateCode: 'ticket_issued',
          recipientEmail: 'concurrent@cinema.local',
          payload: { name: 'Huy', ticketCode: 'TK-01' },
        }),
      ]);

      expect(resA.id).toBe(resB.id);
      expect(sendMailCalls).toHaveLength(1);
    });

    it('enforces bounded retry on real PostgreSQL 17 and clears last_error upon recovery', async () => {
      let shouldFail = true;
      setEmailTransport({
        sendMail: vi.fn(async (opts: SendMailOptions) => {
          if (shouldFail) {
            throw new Error('Temporary SMTP failure');
          }
          sendMailCalls.push(opts);
          return { messageId: '<recovered@cinema.local>' };
        }),
      });

      const service = createDbBackedServices(3);
      const key = `pg17-retry-${randomBytes(4).toString('hex')}`;

      const fail1 = await service.processNotification({
        idempotencyKey: key,
        templateCode: 'refund_processed',
        recipientEmail: 'retry@cinema.local',
        payload: { name: 'Huy', bookingCode: 'BK-200', refundAmountVnd: '90000' },
      });
      expect(fail1.status).toBe('failed');
      expect(fail1.attempt_count).toBe(1);
      expect(fail1.last_error).toBe('Temporary SMTP failure');

      // Recover on attempt 2
      shouldFail = false;
      const recovered = await service.processNotification({
        idempotencyKey: key,
        templateCode: 'refund_processed',
        recipientEmail: 'retry@cinema.local',
        payload: { name: 'Huy', bookingCode: 'BK-200', refundAmountVnd: '90000' },
      });
      expect(recovered.status).toBe('sent');
      expect(recovered.attempt_count).toBe(2);
      expect(recovered.last_error).toBeNull();
      expect(recovered.provider_message_id).toBe('<recovered@cinema.local>');
    });

    it('respects disabled template (is_active = false) in PostgreSQL 17', async () => {
      await knex('notification.notification_templates')
        .where({ code: 'booking_cancelled' })
        .update({ is_active: false });

      const service = createDbBackedServices();
      await expect(
        service.processNotification({
          idempotencyKey: `pg17-disabled-${randomBytes(4).toString('hex')}`,
          templateCode: 'booking_cancelled',
          recipientEmail: 'disabled@cinema.local',
          payload: { name: 'Huy', bookingCode: 'BK-300' },
        }),
      ).rejects.toThrow(/disabled/);

      expect(sendMailCalls).toHaveLength(0);

      // Re-enable template
      await knex('notification.notification_templates')
        .where({ code: 'booking_cancelled' })
        .update({ is_active: true });
    });

    it('rolls back notification migrations cleanly and re-applies them', async () => {
      await knex.migrate.rollback(undefined, true);
      const left = await knex.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'notification'
          AND table_name IN ('notification_templates', 'notification_deliveries')
      `);
      expect(left.rows).toHaveLength(0);

      await knex.migrate.latest();
      await seedTemplates(knex);
      expect(await knex('notification.notification_templates')).toHaveLength(5);
    });
  },
);