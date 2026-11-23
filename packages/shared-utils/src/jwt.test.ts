import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signServiceJwt, verifyServiceJwt } from './jwt.js';

function forgeCustomToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8')
    .toString('base64url');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

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

    expect(claims.iss).toBe('cinema-internal');
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

  it('rejects token with mismatched audience or wildcard cinema-services audience', () => {
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

    const wildcardAudToken = signServiceJwt({
      sub: 'core-service',
      aud: 'cinema-services',
      scope: ['notifications:send'],
      secret,
    });

    expect(() =>
      verifyServiceJwt({
        token: wildcardAudToken,
        secret,
        expectedAudience: 'notification-service',
      }),
    ).toThrow('Invalid audience');
  });

  it('rejects token with missing or wrong issuer (iss)', () => {
    const wrongIssuerToken = signServiceJwt({
      sub: 'core-service',
      aud: 'notification-service',
      scope: ['notifications:send'],
      issuer: 'evil-issuer',
      secret,
    });

    expect(() =>
      verifyServiceJwt({
        token: wrongIssuerToken,
        secret,
        expectedAudience: 'notification-service',
      }),
    ).toThrow('Invalid issuer');

    const missingIssuerToken = forgeCustomToken(
      {
        sub: 'core-service',
        aud: 'notification-service',
        exp: Math.floor(Date.now() / 1000) + 60,
        scope: ['notifications:send'],
      },
      secret,
    );

    expect(() =>
      verifyServiceJwt({
        token: missingIssuerToken,
        secret,
        expectedAudience: 'notification-service',
      }),
    ).toThrow('Invalid issuer');
  });

  it('rejects token with missing or non-numeric exp claim', () => {
    const noExpToken = forgeCustomToken(
      {
        iss: 'cinema-internal',
        sub: 'core-service',
        aud: 'notification-service',
        scope: ['notifications:send'],
      },
      secret,
    );

    expect(() =>
      verifyServiceJwt({
        token: noExpToken,
        secret,
        expectedAudience: 'notification-service',
      }),
    ).toThrow('Missing or invalid JWT expiration (exp)');
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
