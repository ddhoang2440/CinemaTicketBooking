import { createClient, type RedisClientType } from 'redis';
import { env } from './env.js';
import { logger } from '../common/utils/logger.js';

let redisClient: RedisClientType | null = null;

/**
 * ACCEPTED D-14: Shared Redis configuration for distributed rate limiting.
 */
export function getRedisConfig(): { url: string; serviceNamespace: string } {
  return {
    url: env.REDIS_URL,
    serviceNamespace: `cinema:${env.SERVICE_NAME}`,
  };
}

export function getRedisClient(): RedisClientType {
  if (!redisClient) {
    redisClient = createClient({ url: env.REDIS_URL });
    redisClient.on('error', (err: unknown) => {
      logger.error('Redis client error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
  }
  redisClient = null;
}
