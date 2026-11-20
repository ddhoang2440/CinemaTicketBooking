import { describe, expect, it } from 'vitest';
import { signServiceJwt, verifyServiceJwt } from './jwt.js';

describe('Shared Utils — Service JWT (D-13)', () => {
  const secret = 'test-secret-at-least-32-bytes-long-for-hmac';

  it('signs and verifies a valid service JWT', () => {
    const token = signServiceJwt({
      sub: 'core-service',
      aud: 'notification-service',
      scope: ['notifications:send'],
      secret,
    });

    const claims = verifyServiceJwt({
      token,
      secret,
      expectedAudience: 'notification-service',
      requiredScope: 'notifications:send',
    });

    expect(claims.sub).toBe('core-service');
    expect(claims.aud).toBe('notification-service');
    expect(claims.scope).toContain('notifications:send');
  });

  it('rejects token with invalid signature', () => {
    const token = signServiceJwt({
      sub: 'core-service',
      aud: 'notification-service',
      scope: ['notifications:send'],
      secret,
    });

    expect(() =>
      verifyServiceJwt({
        token,
        secret: 'wrong-secret-key-that-does-not-match',
      }),
    ).toThrow('Invalid JWT signature');
  });

  it('rejects token with mismatched audience', () => {
    const token = signServiceJwt({
      sub: 'core-service',
      aud: 'payment-service',
      scope: ['notifications:send'],
      secret,
    });

    expect(() =>
      verifyServiceJwt({
        token,
        secret,
        expectedAudience: 'notification-service',
      }),
    ).toThrow('Invalid audience');
  });

  it('rejects token with missing required scope', () => {
    const token = signServiceJwt({
      sub: 'core-service',
      aud: 'notification-service',
      scope: ['other:scope'],
      secret,
    });

    expect(() =>
      verifyServiceJwt({
        token,
        secret,
        requiredScope: 'notifications:send',
      }),
    ).toThrow('Missing required scope');
  });

  it('rejects expired token', () => {
    const token = signServiceJwt({
      sub: 'core-service',
      aud: 'notification-service',
      scope: ['notifications:send'],
      secret,
      expiresInSeconds: -10, // already expired
    });

    expect(() =>
      verifyServiceJwt({
        token,
        secret,
      }),
    ).toThrow('Service JWT expired');
  });
});
