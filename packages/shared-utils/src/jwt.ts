import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ServiceJwtClaims, ServiceName } from '@cinema/shared-types';

function base64UrlEncode(str: string | Buffer): string {
  const buf = typeof str === 'string' ? Buffer.from(str, 'utf8') : str;
  return buf.toString('base64url');
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf8');
}

export interface CreateServiceJwtOptions {
  sub: ServiceName;
  aud: ServiceName | string;
  scope: string[];
  secret: string;
  issuer?: string;
  expiresInSeconds?: number;
}

/**
 * Signs an internal service-to-service JWT according to D-13.
 * Default expiration is 60 seconds.
 */
export function signServiceJwt(options: CreateServiceJwtOptions): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (options.expiresInSeconds ?? 60);

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const payload: ServiceJwtClaims = {
    iss: options.issuer ?? 'cinema-internal',
    sub: options.sub,
    aud: options.aud,
    iat: now,
    exp,
    jti: randomUUID(),
    scope: options.scope,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac('sha256', options.secret).update(data).digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${data}.${encodedSignature}`;
}

export interface VerifyServiceJwtOptions {
  token: string;
  secret: string;
  expectedAudience?: ServiceName | string;
  requiredScope?: string;
}

/**
 * Verifies an internal service-to-service JWT according to D-13.
 * Checks signature, expiration, audience match, and required scope.
 */
export function verifyServiceJwt(options: VerifyServiceJwtOptions): ServiceJwtClaims {
  const parts = options.token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Invalid JWT format');
  }

  const encodedHeader = parts[0];
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];

  const data = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac('sha256', options.secret).update(data).digest();
  const providedSignature = Buffer.from(encodedSignature, 'base64url');

  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new Error('Invalid JWT signature');
  }

  const header = JSON.parse(base64UrlDecode(encodedHeader));
  if (header.alg !== 'HS256') {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as ServiceJwtClaims;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Service JWT expired');
  }

  if (options.expectedAudience) {
    if (payload.aud !== options.expectedAudience && payload.aud !== 'cinema-services') {
      throw new Error(`Invalid audience: expected ${options.expectedAudience}, got ${payload.aud}`);
    }
  }

  if (options.requiredScope) {
    const scopes = Array.isArray(payload.scope) ? payload.scope : [];
    const hasScope = scopes.includes('*') || scopes.includes(options.requiredScope);
    if (!hasScope) {
      throw new Error(`Missing required scope: ${options.requiredScope}`);
    }
  }

  return payload;
}
