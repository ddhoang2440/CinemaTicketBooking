import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { signServiceJwt } from '@cinema/shared-utils';
import { env } from '../src/config/env.js';
import { setEmailTransport } from '../src/modules/email/email.transport.js';
import {
  setDeliveryRepository,
  type CreateDeliveryParams,
  type DeliveryRepository,
} from '../src/modules/delivery/delivery.repository.js';
import type { DeliveryRecord } from '../src/modules/delivery/delivery.types.js';
import {
  DEFAULT_TEMPLATES,
  setTemplateRepository,
} from '../src/modules/templates/template.service.js';

describe('POST /internal/notifications/send — API Contract Tests', () => {
  const app = createApp();
  let inMemoryDeliveries: Map<string, DeliveryRecord>;

  beforeEach(() => {
    inMemoryDeliveries = new Map();

    setEmailTransport({
      sendMail: vi.fn(async () => ({ messageId: 'test-message-id-001' })),
    });

    setTemplateRepository({
      findByCode: vi.fn(async (code: string) => DEFAULT_TEMPLATES[code] ?? null),
    });

    const mockRepo: DeliveryRepository = {
      findByIdempotencyKey: vi.fn(async (key: string) => inMemoryDeliveries.get(key) ?? null),
      create: vi.fn(async (params: CreateDeliveryParams): Promise<DeliveryRecord> => {
        const record: DeliveryRecord = {
          id: 'del-api-test-001',
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
          created_at: new Date(),
          updated_at: new Date(),
        };
        inMemoryDeliveries.set(params.idempotencyKey, record);
        return record;
      }),
      claimForRetry: vi.fn(async (id: string, maxAttempts: number) => {
        for (const rec of inMemoryDeliveries.values()) {
          if (rec.id === id && rec.status === 'failed' && rec.attempt_count < maxAttempts) {
            rec.status = 'queued';
            return rec;
          }
        }
        return null;
      }),
      markSent: vi.fn(async (id: string, providerMessageId?: string | null) => {
        for (const rec of inMemoryDeliveries.values()) {
          if (rec.id === id) {
            rec.status = 'sent';
            rec.provider_message_id = providerMessageId ?? null;
            rec.last_error = null;
            rec.sent_at = new Date();
            rec.attempt_count += 1;
            return rec;
          }
        }
        throw new Error('Record not found');
      }),
      markFailed: vi.fn(async (id: string, errorMessage: string) => {
        for (const rec of inMemoryDeliveries.values()) {
          if (rec.id === id) {
            rec.status = 'failed';
            rec.last_error = errorMessage;
            rec.attempt_count += 1;
            return rec;
          }
        }
        throw new Error('Record not found');
      }),
    };
    setDeliveryRepository(mockRepo);
  });

  afterEach(() => {
    setDeliveryRepository(null);
    setTemplateRepository(null);
    setEmailTransport(null);
  });

  const validPayload = {
    templateCode: 'booking_confirmed',
    recipientEmail: 'huy.vo@example.com',
    idempotencyKey: 'idemp-req-valid-001',
    payload: {
      name: 'Võ Minh Huy',
      bookingCode: 'BKG-001',
      movieTitle: 'Spider-Man',
      cinemaName: 'CGV Landmark',
      totalVnd: '150,000',
    },
  };

  it('rejects call with 401 UNAUTHORIZED when Authorization header is missing', async () => {
    const res = await request(app).post('/internal/notifications/send').send(validPayload);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects call with 401 UNAUTHORIZED when token uses wildcard cinema-services audience', async () => {
    const wildcardAudToken = signServiceJwt({
      sub: 'core-service',
      aud: 'cinema-services',
      scope: ['notifications:send'],
      secret: env.SERVICE_JWT_SECRET,
    });

    const res = await request(app)
      .post('/internal/notifications/send')
      .set('Authorization', `Bearer ${wildcardAudToken}`)
      .send(validPayload);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects call with 403 FORBIDDEN when token lacks notifications:send scope', async () => {
    const tokenWithoutScope = signServiceJwt({
      sub: 'core-service',
      aud: 'notification-service',
      scope: ['payments:read'],
      secret: env.SERVICE_JWT_SECRET,
    });

    const res = await request(app)
      .post('/internal/notifications/send')
      .set('Authorization', `Bearer ${tokenWithoutScope}`)
      .send(validPayload);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects call with 400 VALIDATION_ERROR when request body is invalid or has extra fields', async () => {
    const validToken = signServiceJwt({
      sub: 'core-service',
      aud: 'notification-service',
      scope: ['notifications:send'],
      secret: env.SERVICE_JWT_SECRET,
    });

    const res = await request(app)
      .post('/internal/notifications/send')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        templateCode: 'invalid_template_code',
        recipientEmail: 'not-an-email',
        idempotencyKey: 'short',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    const extraFieldRes = await request(app)
      .post('/internal/notifications/send')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        ...validPayload,
        unexpectedField: true,
      });

    expect(extraFieldRes.status).toBe(400);
    expect(extraFieldRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects call with 400 INVALID_JSON when request body is malformed JSON', async () => {
    const validToken = signServiceJwt({
      sub: 'core-service',
      aud: 'notification-service',
      scope: ['notifications:send'],
      secret: env.SERVICE_JWT_SECRET,
    });

    const res = await request(app)
      .post('/internal/notifications/send')
      .set('Authorization', `Bearer ${validToken}`)
      .set('Content-Type', 'application/json')
      .send('{"templateCode": "booking_confirmed", broken-json');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('accepts call with 202 ACCEPTED when signed service JWT and payload are valid', async () => {
    const validToken = signServiceJwt({
      sub: 'core-service',
      aud: 'notification-service',
      scope: ['notifications:send'],
      secret: env.SERVICE_JWT_SECRET,
    });

    const res = await request(app)
      .post('/internal/notifications/send')
      .set('Authorization', `Bearer ${validToken}`)
      .send(validPayload);

    expect(res.status).toBe(202);
    expect(res.body.data.deliveryId).toBeDefined();
    expect(res.body.data.idempotencyKey).toBe('idemp-req-valid-001');
    expect(res.body.data.recipientEmail).toBe('huy.vo@example.com');
    expect(res.body.data.providerMessageId).toBe('test-message-id-001');
    expect(res.body.meta.requestId).toBeDefined();
  });
});
