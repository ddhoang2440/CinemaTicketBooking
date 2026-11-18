import type { Request, Response } from 'express';
import type { ApiErrorResponse } from '@cinema/shared-types';

export function notFoundHandler(req: Request, res: Response<ApiErrorResponse>): void {
  res.status(404).json({
    error: {
      code: 'RESOURCE_NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} was not found on notification-service.`,
    },
    meta: {
      requestId: req.requestId,
    },
  });
}
