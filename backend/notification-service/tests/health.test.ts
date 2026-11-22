import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AppError } from '../src/common/errors/AppError.js';
import { logger } from '../src/common/utils/logger.js';
import { uuidParamSchema } from '../src/common/validators/index.js';
import { getDbConfig } from '../src/config/database.js';
import { parseEnv } from '../src/config/env.js';
import { getRedisConfig } from '../src/config/redis.js';
import { EMAIL_MODULE } from '../src/modules/email/index.js';
import { TEMPLATES_MODULE } from '../src/modules/templates/index.js';
import { DELIVERY_MODULE } from '../src/modules/delivery/index.js';

describe('notification-service — Smoke & Infrastructure Tests', () => {
  const app = createApp();

  it('GET /health returns 200 OK with service and schema metadata', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.body).toEqual({
      data: {
        status: 'ok',
        service: 'notification-service',
        schema: 'notification',
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
    expect(parsed.SERVICE_NAME).toBe('notification-service');
    expect(parsed.DB_SCHEMA).toBe('notification');
    expect(parsed.PORT).toBe(4003);

    const dbConfig = getDbConfig();
    expect(dbConfig.searchPath).toEqual(['notification']);

    const redisConfig = getRedisConfig();
    expect(redisConfig.serviceNamespace).toBe('cinema:notification-service');

    const appErr = new AppError(409, 'CONFLICT_TEST', 'Test conflict', { field: 'seatId' });
    expect(appErr.statusCode).toBe(409);
    expect(appErr.code).toBe('CONFLICT_TEST');

    expect(uuidParamSchema.safeParse({ id: '8a86aa39-58da-4c58-aa9e-d6a49cb0b8d4' }).success).toBe(
      true,
    );

    expect(EMAIL_MODULE.service).toBe('notification-service');
    expect(TEMPLATES_MODULE.service).toBe('notification-service');
    expect(DELIVERY_MODULE.service).toBe('notification-service');

    logger.info('smoke test log');
    logger.warn('smoke warn log');
    logger.error('smoke error log');
  });
});
