import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { errorHandler } from './common/middleware/errorHandler.js';
import { notFoundHandler } from './common/middleware/notFound.js';
import { requestIdMiddleware } from './common/middleware/requestId.js';
import { env } from './config/env.js';
import { healthRouter } from './modules/health/health.routes.js';

/**
 * Creates the Express 5 application instance for payment-service (TV4 — Payment Processing, Webhooks & Refunds).
 * Owned API paths: /api/v1/payments, /internal/payments
 * Owned PostgreSQL schema: payment
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(requestIdMiddleware);

  // Infrastructure health endpoints (/health, /health/live, /health/ready & /api/v1/health/*)
  app.use('/health', healthRouter);
  app.use('/api/v1/health', healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
