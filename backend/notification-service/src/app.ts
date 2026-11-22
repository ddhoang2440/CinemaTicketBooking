import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { errorHandler } from './common/middleware/errorHandler.js';
import { notFoundHandler } from './common/middleware/notFound.js';
import { requestIdMiddleware } from './common/middleware/requestId.js';
import { env } from './config/env.js';
import { healthRouter } from './modules/health/health.routes.js';
import { deliveryRouter } from './modules/delivery/delivery.routes.js';

/**
 * Creates the Express 5 application instance for notification-service (TV5 — Email & Notification Delivery).
 * Owned API paths: /internal/notifications
 * Owned PostgreSQL schema: notification
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

  // Internal service-to-service notification endpoints
  app.use('/internal/notifications', deliveryRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
