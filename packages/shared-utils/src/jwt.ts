import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Signed Service JWT Utilities (D-13)
 * Internal service-to-service authentication between core-service, payment-service, and notification-service.
 * Uses HS256 (HMAC-SHA256) with Node's built-in node:crypto for zero external dependency overhead.
 */

export type InternalServiceId = 'core-service' | 'payment-service' | 'notification-service';

export interface ServiceJwtClaims {
  iss: string;
  sub: InternalServiceId | string;
  aud: InternalServiceId | string;
  iat: number;
  exp: number;
  jti: string;
  scope: string[];
}

export interface SignServiceJwtOptions {
  sub: InternalServiceId | string;
  aud: InternalServiceId | string;
  scope: string[];
  secret: string;
  issuer?: string;
  expiresInSeconds?: number;
  jti?: string;
}

export interface VerifyServiceJwtOptions {
  token: string;
  secret: string;
  expectedIssuer?: string;
  expectedAudience?: InternalServiceId | string;
  requiredScope?: string;
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function signServiceJwt(options: SignServiceJwtOptions): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = options.expiresInSeconds ?? 60; // D-13: short-lived 60s service token

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const payload: ServiceJwtClaims = {
    iss: options.issuer ?? 'cinema-internal',
    sub: options.sub,
    aud: options.aud,
    iat: now,
    exp: now + expiresIn,
    jti: options.jti ?? randomUUID(),
    scope: options.scope,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac('sha256', options.secret).update(signingInput).digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

export function verifyServiceJwt(options: VerifyServiceJwtOptions): ServiceJwtClaims {
  const parts = options.token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT token');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  let header: { alg?: unknown; typ?: unknown };
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader)) as { alg?: unknown; typ?: unknown };
  } catch {
    throw new Error('Invalid JWT header JSON');
  }

  if (header.alg !== 'HS256') {
    throw new Error('Unsupported JWT algorithm');
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = createHmac('sha256', options.secret).update(signingInput).digest();

  let actualSig: Buffer;
  try {
    let base64 = encodedSignature.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    actualSig = Buffer.from(base64, 'base64');
  } catch {
    throw new Error('Invalid JWT signature encoding');
  }

  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
    throw new Error('Invalid JWT signature');
  }

  let payload: ServiceJwtClaims;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as ServiceJwtClaims;
  } catch {
    throw new Error('Invalid JWT payload JSON');
  }

  // D-13: Require valid issuer (iss)
  const expectedIssuer = options.expectedIssuer ?? 'cinema-internal';
  if (!payload.iss || typeof payload.iss !== 'string' || payload.iss !== expectedIssuer) {
    throw new Error(`Invalid issuer: expected ${expectedIssuer}, got ${String(payload.iss)}`);
  }

  // D-13: Require valid subject (sub)
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Missing or invalid JWT subject (sub)');
  }

  // D-13: Require numeric expiration (exp) in the future
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new Error('Missing or invalid JWT expiration (exp)');
  }
  if (payload.exp <= now) {
    throw new Error('Service JWT expired');
  }

  // D-13: Require exact audience match (no wildcard 'cinema-services' bypass)
  if (options.expectedAudience) {
    if (!payload.aud || typeof payload.aud !== 'string' || payload.aud !== options.expectedAudience) {
      throw new Error(
        `Invalid audience: expected ${options.expectedAudience}, got ${String(payload.aud)}`,
      );
    }
  } else if (!payload.aud || typeof payload.aud !== 'string') {
    throw new Error('Missing or invalid JWT audience (aud)');
  }

  // D-13: Require valid scope array and requiredScope when specified
  if (!Array.isArray(payload.scope) || !payload.scope.every((s) => typeof s === 'string')) {
    throw new Error('Invalid JWT scope claim');
  }

  if (options.requiredScope) {
    if (!payload.scope.includes(options.requiredScope)) {
      throw new Error(`Missing required scope: ${options.requiredScope}`);
    }
  }

  return payload;
}
