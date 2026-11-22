import type { NextFunction, Request, Response } from 'express';
import { verifyServiceJwt } from '@cinema/shared-utils';
import { AppError } from '../errors/AppError.js';
import { env } from '../../config/env.js';

export function requireServiceAuth(requiredScope: string = 'notifications:send') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing or malformed Authorization header');
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new AppError(401, 'UNAUTHORIZED', 'Bearer token is empty');
    }

    try {
      const claims = verifyServiceJwt({
        token,
        secret: env.SERVICE_JWT_SECRET,
        expectedAudience: 'notification-service',
        requiredScope,
      });

      // Attach service claims to request for logging/tracking
      (req as unknown as { serviceClaims?: unknown }).serviceClaims = claims;
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid service token';
      if (message.includes('Missing required scope')) {
        throw new AppError(403, 'FORBIDDEN', message);
      }
      throw new AppError(401, 'UNAUTHORIZED', message);
    }
  };
}
