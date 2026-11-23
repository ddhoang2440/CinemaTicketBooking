import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorResponse } from '@cinema/shared-types';
import { AppError } from '../errors/AppError.js';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response<ApiErrorResponse>,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      meta: {
        requestId: req.requestId,
      },
    });
    return;
  }

  // Handle malformed JSON body errors thrown by express.json()
  if (
    err instanceof SyntaxError &&
    typeof (err as unknown as { status?: unknown }).status === 'number' &&
    (err as unknown as { status: number }).status === 400
  ) {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON in request body',
      },
      meta: {
        requestId: req.requestId,
      },
    });
    return;
  }

  logger.error('Unhandled request error', {
    requestId: req.requestId,
    error: err instanceof Error ? err.message : String(err),
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    },
    meta: {
      requestId: req.requestId,
    },
  });
}
