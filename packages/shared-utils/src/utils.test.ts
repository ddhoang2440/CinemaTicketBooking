import { describe, expect, it } from 'vitest';
import {
  createRequestId,
  formatVietnamDateTime,
  formatVnd,
  isValidVndAmount,
  toUtcIsoString,
} from './index.js';

describe('@cinema/shared-utils', () => {
  it('generates a valid UUID request ID', () => {
    const id = createRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('validates integer VND amounts per D-18', () => {
    expect(isValidVndAmount(95000)).toBe(true);
    expect(isValidVndAmount(0)).toBe(true);
    expect(isValidVndAmount(-100)).toBe(false);
    expect(isValidVndAmount(95.5)).toBe(false);
    expect(isValidVndAmount('95000')).toBe(false);
  });

  it('formats VND currency and rejects decimals', () => {
    expect(formatVnd(95000)).toContain('95.000');
    expect(() => formatVnd(95.5)).toThrow(RangeError);
  });

  it('formats UTC timestamps to Asia/Ho_Chi_Minh per D-16 / D-18', () => {
    const utcTimestamp = toUtcIsoString(new Date('2026-12-20T12:30:00.000Z'));
    expect(utcTimestamp).toBe('2026-12-20T12:30:00.000Z');
    const vnDisplay = formatVietnamDateTime(utcTimestamp);
    expect(vnDisplay).toContain('19:30');
    expect(vnDisplay).toContain('20/12/2026');
  });
});
