import { randomUUID } from 'node:crypto';
import type { UtcIsoTimestamp, VndAmount } from '@cinema/shared-types';

/**
 * Generates a unique request correlation ID.
 */
export function createRequestId(): string {
  return randomUUID();
}

/**
 * ACCEPTED D-18: Validates that an amount is a non-negative integer VND value.
 */
export function isValidVndAmount(value: unknown): value is VndAmount {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Formats an integer VND amount for Vietnamese locale display.
 */
export function formatVnd(amount: VndAmount): string {
  if (!isValidVndAmount(amount)) {
    throw new RangeError('VND amount must be a non-negative safe integer.');
  }
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * ACCEPTED D-18: Returns a UTC ISO-8601 timestamp string.
 */
export function toUtcIsoString(date: Date = new Date()): UtcIsoTimestamp {
  return date.toISOString();
}

/**
 * ACCEPTED D-18: Formats a UTC ISO-8601 timestamp in Asia/Ho_Chi_Minh timezone for display.
 */
export function formatVietnamDateTime(isoUtc: UtcIsoTimestamp): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid ISO timestamp: ${isoUtc}`);
  }
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export * from './jwt.js';
