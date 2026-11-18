import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { errorHandler } from './common/middleware/errorHandler.js';
import { notFoundHandler } from './common/middleware/notFound.js';
import { requestIdMiddleware } from './common/middleware/requestId.js';
import { env } from './config/env.js';
import { healthRouter } from './modules/health/health.routes.js';

/**
 * Creates the Express 5 application instance for core-service (TV1–TV5 (Modular Core Domain Service)).
 * Owned API paths: /api/v1/auth, /api/v1/users, /api/v1/movies, /api/v1/cinemas, /api/v1/auditoriums, /api/v1/showtimes, /api/v1/seat-holds, /api/v1/bookings, /api/v1/concessions, /api/v1/tickets, /api/v1/checkins, /api/v1/reports
 * Owned PostgreSQL schema: core
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
