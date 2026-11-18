import type { Server } from 'node:http';
import { createApp } from './app.js';
import { logger } from './common/utils/logger.js';
import { closeDb } from './config/database.js';
import { env } from './config/env.js';
import { closeRedis } from './config/redis.js';

const app = createApp();

const server: Server = app.listen(env.PORT, () => {
  logger.info(`${env.SERVICE_NAME} listening on port ${env.PORT}`, {
    port: env.PORT,
    schema: env.DB_SCHEMA,
  });
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  server.close(async () => {
    try {
      await Promise.all([closeDb(), closeRedis()]);
      logger.info('Graceful shutdown complete.');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

export { server };
