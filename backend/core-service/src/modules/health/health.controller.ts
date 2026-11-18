import type { Request, Response } from 'express';
import type { ApiSuccessResponse, HealthStatusPayload } from '@cinema/shared-types';
import { HealthService } from './health.service.js';

const healthService = new HealthService();

export function getHealth(
  req: Request,
  res: Response<ApiSuccessResponse<HealthStatusPayload>>,
): void {
  const payload = healthService.getHealthStatus();
  res.status(200).json({
    data: payload,
    meta: {
      requestId: req.requestId,
    },
  });
}
