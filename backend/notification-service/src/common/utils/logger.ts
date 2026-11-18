import { toUtcIsoString } from '@cinema/shared-utils';
import { env } from '../../config/env.js';

export interface LogContext {
  requestId?: string;
  [key: string]: unknown;
}

function writeLog(level: 'info' | 'warn' | 'error', message: string, context?: LogContext): void {
  if (env.NODE_ENV === 'test') {
    return;
  }
  const entry = {
    timestamp: toUtcIsoString(),
    level,
    service: env.SERVICE_NAME,
    schema: env.DB_SCHEMA,
    message,
    ...context,
  };
  const serialized = JSON.stringify(entry);
  if (level === 'error') {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

export const logger = {
  info(message: string, context?: LogContext): void {
    writeLog('info', message, context);
  },
  warn(message: string, context?: LogContext): void {
    writeLog('warn', message, context);
  },
  error(message: string, context?: LogContext): void {
    writeLog('error', message, context);
  },
};
