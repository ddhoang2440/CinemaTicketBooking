import 'dotenv/config';
import { z } from 'zod';
import type { DatabaseSchemaName, ServiceName } from '@cinema/shared-types';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4003),
  SERVICE_NAME: z
    .enum(['core-service', 'payment-service', 'notification-service'])
    .default('notification-service'),
  DB_SCHEMA: z.enum(['core', 'payment', 'notification']).default('notification'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://cinema_user:cinema_dev_password_placeholder@localhost:5432/cinema'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  CORE_SERVICE_URL: z.string().min(1).default('http://localhost:4001'),
  PAYMENT_SERVICE_URL: z.string().min(1).default('http://localhost:4002'),
  NOTIFICATION_SERVICE_URL: z.string().min(1).default('http://localhost:4003'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SEAT_HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  MAX_BOOKING_SEATS: z.coerce.number().int().positive().default(8),
  CANCELLATION_CUTOFF_MINUTES: z.coerce.number().int().positive().default(120),
  CHECKIN_EARLY_MINUTES: z.coerce.number().int().nonnegative().default(30),
  CHECKIN_LATE_MINUTES: z.coerce.number().int().nonnegative().default(30),
  SHOWTIME_BUFFER_MINUTES: z.coerce.number().int().nonnegative().default(15),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('Cinema Booking <no-reply@cinema.local>'),
  SERVICE_JWT_ISSUER: z.string().default('cinema-internal'),
  SERVICE_JWT_AUDIENCE: z.string().default('cinema-services'),
  SERVICE_JWT_SECRET: z
    .string()
    .min(1)
    .default('replace_with_at_least_32_byte_internal_service_secret'),
});

export type ServiceEnv = z.infer<typeof envSchema> & {
  SERVICE_NAME: ServiceName;
  DB_SCHEMA: DatabaseSchemaName;
};

export function parseEnv(input: NodeJS.ProcessEnv = process.env): ServiceEnv {
  return envSchema.parse(input);
}

export const env: ServiceEnv = parseEnv(process.env);
