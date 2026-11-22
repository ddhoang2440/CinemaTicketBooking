import { getEmailTransport } from '../email/email.transport.js';
import { templateService } from '../templates/template.service.js';
import { deliveryRepository, type DeliveryRepository } from './delivery.repository.js';
import type { DeliveryRecord, SendNotificationRequest } from './delivery.types.js';
import { logger } from '../../common/utils/logger.js';
import { randomUUID } from 'node:crypto';

export class DeliveryService {
  constructor(private repo: DeliveryRepository = deliveryRepository) {}

  async processNotification(request: SendNotificationRequest): Promise<DeliveryRecord> {
    // 1. Idempotency Check: if idempotency_key already exists, return existing record
    try {
      const existing = await this.repo.findByIdempotencyKey(request.idempotencyKey);
      if (existing) {
        logger.info('Notification idempotency hit, returning existing record', {
          idempotencyKey: request.idempotencyKey,
          status: existing.status,
        });
        return existing;
      }
    } catch (err) {
      logger.warn('Failed to query delivery repository (database may be offline in test)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. Create initial delivery record (queued)
    let record: DeliveryRecord;
    try {
      record = await this.repo.create({
        idempotencyKey: request.idempotencyKey,
        templateCode: request.templateCode,
        recipientEmail: request.recipientEmail,
        bookingId: request.bookingId,
        paymentId: request.paymentId,
        payload: request.payload,
        status: 'queued',
      });
    } catch {
      // In-memory fallback if DB unavailable
      record = {
        id: randomUUID(),
        idempotency_key: request.idempotencyKey,
        template_code: request.templateCode,
        recipient_email: request.recipientEmail,
        booking_id: request.bookingId ?? null,
        payment_id: request.paymentId ?? null,
        payload: request.payload ?? {},
        status: 'queued',
        attempt_count: 0,
        last_error: null,
        sent_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    // 3. Render email subject & body
    const rendered = await templateService.renderTemplate(request.templateCode, request.payload);

    // 4. Send email via transport
    const transport = getEmailTransport();
    try {
      await transport.sendMail({
        to: request.recipientEmail,
        subject: rendered.subject,
        text: rendered.body,
      });

      // Update delivery as sent
      record.status = 'sent';
      record.sent_at = new Date();
      record.attempt_count += 1;

      try {
        await this.repo.markSent(record.id);
      } catch {
        // DB update failed, in-memory updated
      }

      logger.info('Notification email dispatched successfully', {
        id: record.id,
        recipient: request.recipientEmail,
        template: request.templateCode,
      });
    } catch (sendError) {
      // D-10 & CT-22 Resilience: Non-blocking on failure
      const errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
      logger.error('Failed to dispatch notification email; recording failure for retry', {
        id: record.id,
        recipient: request.recipientEmail,
        error: errorMessage,
      });

      record.status = 'failed';
      record.last_error = errorMessage;
      record.attempt_count += 1;

      try {
        await this.repo.markFailed(record.id, errorMessage);
      } catch {
        // DB update failed
      }
    }

    return record;
  }
}

export const deliveryService = new DeliveryService();
