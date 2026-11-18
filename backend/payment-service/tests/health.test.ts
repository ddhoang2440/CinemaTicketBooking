import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AppError } from '../src/common/errors/AppError.js';
import { logger } from '../src/common/utils/logger.js';
import { uuidParamSchema } from '../src/common/validators/index.js';
import { getDbConfig } from '../src/config/database.js';
import { parseEnv } from '../src/config/env.js';
import { getRedisConfig } from '../src/config/redis.js';
import { PAYMENTS_MODULE } from '../src/modules/payments/index.js';
import { WEBHOOKS_MODULE } from '../src/modules/webhooks/index.js';
import { REFUNDS_MODULE } from '../src/modules/refunds/index.js';

describe('payment-service — Smoke & Infrastructure Tests', () => {
  const app = createApp();

  it('GET /health returns 200 OK with service and schema metadata', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.body).toEqual({
      data: {
        status: 'ok',
        service: 'payment-service',
        schema: 'payment',
        timestamp: expect.any(String),
      },
      meta: {
        requestId: expect.any(String),
      },
    });
  });

  it('propagates incoming x-request-id header on GET /api/v1/health/live', async () => {
    const customRequestId = 'req-custom-smoke-test-001';
    const response = await request(app)
      .get('/api/v1/health/live')
      .set('x-request-id', customRequestId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(customRequestId);
    expect(response.body.meta.requestId).toBe(customRequestId);
  });

  it('returns standard 404 error envelope for unknown routes', async () => {
    const response = await request(app).get('/api/v1/non-existent-scaffold-route');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(response.body.meta.requestId).toBeDefined();
  });

  it('validates database, redis, module boundaries, and environment configuration defaults', () => {
    const parsed = parseEnv({ NODE_ENV: 'test' });
    expect(parsed.SERVICE_NAME).toBe('payment-service');
    expect(parsed.DB_SCHEMA).toBe('payment');
    expect(parsed.PORT).toBe(4002);

    const dbConfig = getDbConfig();
    expect(dbConfig.searchPath).toEqual(['payment']);

    const redisConfig = getRedisConfig();
    expect(redisConfig.serviceNamespace).toBe('cinema:payment-service');

    const appErr = new AppError(409, 'CONFLICT_TEST', 'Test conflict', { field: 'seatId' });
    expect(appErr.statusCode).toBe(409);
    expect(appErr.code).toBe('CONFLICT_TEST');

    expect(
      uuidParamSchema.safeParse({ id: '8a86aa39-58da-4c58-aa9e-d6a49cb0b8d4' }).success,
    ).toBe(true);

    expect(PAYMENTS_MODULE.service).toBe('payment-service');
    expect(WEBHOOKS_MODULE.service).toBe('payment-service');
    expect(REFUNDS_MODULE.service).toBe('payment-service');

    logger.info('smoke test log');
    logger.warn('smoke warn log');
    logger.error('smoke error log');
  });
});
