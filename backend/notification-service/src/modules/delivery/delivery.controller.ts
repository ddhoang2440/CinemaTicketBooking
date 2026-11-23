import type { Request, Response } from 'express';
import { sendNotificationRequestSchema } from './delivery.types.js';
import { deliveryService } from './delivery.service.js';
import { AppError } from '../../common/errors/AppError.js';
import type { ApiSuccessResponse } from '@cinema/shared-types';

export async function sendNotificationHandler(
  req: Request,
  res: Response<ApiSuccessResponse<unknown>>,
): Promise<void> {
  const parseResult = sendNotificationRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid notification payload', {
      errors: parseResult.error.flatten().fieldErrors,
    });
  }

  const record = await deliveryService.processNotification(parseResult.data);

  res.status(202).json({
    data: {
      deliveryId: record.id,
      idempotencyKey: record.idempotency_key,
      status: record.status,
      templateCode: record.template_code,
      recipientEmail: record.recipient_email,
      attemptCount: record.attempt_count,
      providerMessageId: record.provider_message_id ?? null,
      sentAt: record.sent_at ? new Date(record.sent_at).toISOString() : null,
      lastError: record.last_error,
    },
    meta: {
      requestId: req.requestId,
    },
  });
}
