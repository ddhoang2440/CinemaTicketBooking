import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AppError } from '../src/common/errors/AppError.js';
import { logger } from '../src/common/utils/logger.js';
import { uuidParamSchema } from '../src/common/validators/index.js';
import { getDbConfig } from '../src/config/database.js';
import { parseEnv } from '../src/config/env.js';
import { getRedisConfig } from '../src/config/redis.js';
import { AUTH_MODULE } from '../src/modules/auth/index.js';
import { USERS_MODULE } from '../src/modules/users/index.js';
import { ROLES_MODULE } from '../src/modules/roles/index.js';
import { MOVIES_MODULE } from '../src/modules/movies/index.js';
import { CINEMAS_MODULE } from '../src/modules/cinemas/index.js';
import { AUDITORIUMS_MODULE } from '../src/modules/auditoriums/index.js';
import { SEATS_MODULE } from '../src/modules/seats/index.js';
import { SHOWTIMES_MODULE } from '../src/modules/showtimes/index.js';
import { PRICING_MODULE } from '../src/modules/pricing/index.js';
import { SEAT_HOLDS_MODULE } from '../src/modules/seat-holds/index.js';
import { BOOKINGS_MODULE } from '../src/modules/bookings/index.js';
import { CONCESSIONS_MODULE } from '../src/modules/concessions/index.js';
import { TICKETS_MODULE } from '../src/modules/tickets/index.js';
import { CHECKINS_MODULE } from '../src/modules/checkins/index.js';
import { REPORTS_MODULE } from '../src/modules/reports/index.js';

describe('core-service — Smoke & Infrastructure Tests', () => {
  const app = createApp();

  it('GET /health returns 200 OK with service and schema metadata', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.body).toEqual({
      data: {
        status: 'ok',
        service: 'core-service',
        schema: 'core',
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
    expect(parsed.SERVICE_NAME).toBe('core-service');
    expect(parsed.DB_SCHEMA).toBe('core');
    expect(parsed.PORT).toBe(4001);

    const dbConfig = getDbConfig();
    expect(dbConfig.searchPath).toEqual(['core']);

    const redisConfig = getRedisConfig();
    expect(redisConfig.serviceNamespace).toBe('cinema:core-service');

    const appErr = new AppError(409, 'CONFLICT_TEST', 'Test conflict', { field: 'seatId' });
    expect(appErr.statusCode).toBe(409);
    expect(appErr.code).toBe('CONFLICT_TEST');

    expect(
      uuidParamSchema.safeParse({ id: '8a86aa39-58da-4c58-aa9e-d6a49cb0b8d4' }).success,
    ).toBe(true);

    expect(AUTH_MODULE.service).toBe('core-service');
    expect(USERS_MODULE.service).toBe('core-service');
    expect(ROLES_MODULE.service).toBe('core-service');
    expect(MOVIES_MODULE.service).toBe('core-service');
    expect(CINEMAS_MODULE.service).toBe('core-service');
    expect(AUDITORIUMS_MODULE.service).toBe('core-service');
    expect(SEATS_MODULE.service).toBe('core-service');
    expect(SHOWTIMES_MODULE.service).toBe('core-service');
    expect(PRICING_MODULE.service).toBe('core-service');
    expect(SEAT_HOLDS_MODULE.service).toBe('core-service');
    expect(BOOKINGS_MODULE.service).toBe('core-service');
    expect(CONCESSIONS_MODULE.service).toBe('core-service');
    expect(TICKETS_MODULE.service).toBe('core-service');
    expect(CHECKINS_MODULE.service).toBe('core-service');
    expect(REPORTS_MODULE.service).toBe('core-service');

    logger.info('smoke test log');
    logger.warn('smoke warn log');
    logger.error('smoke error log');
  });
});
