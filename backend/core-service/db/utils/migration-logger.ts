import type { LogContext } from '../../src/common/utils/logger.js';

type LogLevel = 'info' | 'warn' | 'error';

export interface MigrationLogger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const SENSITIVE_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s'"]+/gi;
const SENSITIVE_KV_PATTERN = /(password|passwd|secret|token|authorization)=([^\s&;,'"]+)/gi;

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(SENSITIVE_URL_PATTERN, '[REDACTED_CONNECTION_URI]')
    .replace(SENSITIVE_KV_PATTERN, '$1=[REDACTED]');
}

function createFallbackLogger(): MigrationLogger {
  const writeFallbackLog = (level: LogLevel, message: string, context?: LogContext): void => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: process.env.SERVICE_NAME ?? 'core-service',
      schema: process.env.DB_SCHEMA ?? 'core',
      message,
      ...context,
    };

    const serialized = JSON.stringify(entry);
    if (level === 'error') {
      console.error(serialized);
    } else {
      console.log(serialized);
    }
  };

  return {
    info(message: string, context?: LogContext): void {
      writeFallbackLog('info', message, context);
    },
    warn(message: string, context?: LogContext): void {
      writeFallbackLog('warn', message, context);
    },
    error(message: string, context?: LogContext): void {
      writeFallbackLog('error', message, context);
    },
  };
}

let cachedLoggerPromise: Promise<MigrationLogger> | null = null;

export async function getMigrationLogger(): Promise<MigrationLogger> {
  if (cachedLoggerPromise !== null) {
    return cachedLoggerPromise;
  }

  cachedLoggerPromise = (async (): Promise<MigrationLogger> => {
    const candidateSpecifiers = [
      '../../src/common/utils/logger.js',
      '../../dist/src/common/utils/logger.js',
    ] as const;

    for (const specifier of candidateSpecifiers) {
      try {
        const mod = (await import(specifier)) as { logger?: MigrationLogger };
        if (
          mod.logger &&
          typeof mod.logger.info === 'function' &&
          typeof mod.logger.warn === 'function' &&
          typeof mod.logger.error === 'function'
        ) {
          return mod.logger;
        }
      } catch {
        // Continue to next candidate logger path.
      }
    }

    return createFallbackLogger();
  })();

  return cachedLoggerPromise;
}

export async function runLoggedMigration(
  migrationName: string,
  direction: 'up' | 'down',
  fn: () => Promise<void>,
): Promise<void> {
  const log = await getMigrationLogger();
  const startedAt = Date.now();
  const schema = process.env.DB_SCHEMA ?? 'core';

  log.info('Migration started', {
    migration: migrationName,
    direction,
    schema,
  });

  try {
    await fn();
    log.info('Migration completed', {
      migration: migrationName,
      direction,
      schema,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: unknown) {
    const rawCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    const errorCode = typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : 'UNKNOWN';
    const rawMessage = error instanceof Error ? error.message : String(error);

    log.error('Migration failed', {
      migration: migrationName,
      direction,
      schema,
      durationMs: Date.now() - startedAt,
      errorCode,
      errorMessage: sanitizeErrorMessage(rawMessage),
    });

    throw error;
  }
}
