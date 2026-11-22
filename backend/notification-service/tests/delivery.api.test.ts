import request from 'supertest';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { signServiceJwt } from '@cinema/shared-utils';
import { env } from '../src/config/env.js';
import { setEmailTransport } from '../src/modules/email/email.transport.js';

describe('POST /internal/notifications/send — API Contract Tests', () => {
  const app = createApp();

  beforeEach(() => {
    // Mock transport to avoid live network calls during test
    setEmailTransport({
      sendMail: vi.fn(async () => ({ messageId: 'test-message-id' })),
    });
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

  it('rejects call with 403 FORBIDDEN when token lacks notifications:send scope', async () => {
    const tokenWithoutScope = signServiceJwt({
      sub: 'core-service',
      aud: 'notification-service',
      scope: ['payments:read'], // missing notifications:send
      secret: env.SERVICE_JWT_SECRET,
    });

    const res = await request(app)
      .post('/internal/notifications/send')
      .set('Authorization', `Bearer ${tokenWithoutScope}`)
      .send(validPayload);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects call with 400 VALIDATION_ERROR when request body is invalid', async () => {
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
        idempotencyKey: 'short', // less than 8 chars
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
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
    expect(res.body.meta.requestId).toBeDefined();
  });
});
