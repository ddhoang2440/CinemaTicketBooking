import {
  getDeliveryRepository,
  type DeliveryRepository,
} from './delivery.repository.js';
import type { DeliveryRecord, SendNotificationRequest } from './delivery.types.js';
import { templateService, type TemplateService } from '../templates/template.service.js';
import { getEmailTransport } from '../email/email.transport.js';
import { logger } from '../../common/utils/logger.js';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/AppError.js';

export interface DeliveryServiceOptions {
  maxAttempts?: number;
}

function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

export class DeliveryService {
  private readonly maxAttempts: number;

  constructor(
    private readonly repo?: DeliveryRepository,
    private readonly templates: TemplateService = templateService,
    options: DeliveryServiceOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? env.NOTIFICATION_MAX_ATTEMPTS ?? 3;
  }

  private getRepository(): DeliveryRepository {
    return this.repo ?? getDeliveryRepository();
  }

  /**
   * Processes an internal notification delivery request idempotently.
   * - Never fabricates in-memory fallback records when database persistence fails.
   * - Prevents duplicate email sends under retries or concurrent requests.
   * - Enforces bounded retry (up to maxAttempts) with persistent attempt_count tracking.
   * - Persists provider_message_id on success and respects disabled templates (is_active = false).
   */
  async processNotification(request: SendNotificationRequest): Promise<DeliveryRecord> {
    const repo = this.getRepository();

    // 1. Check idempotency key in persistent repository
    const existing = await repo.findByIdempotencyKey(request.idempotencyKey);
    let record: DeliveryRecord;

    if (existing) {
      // Sent or currently queued in-flight -> return idempotently without sending again
      if (existing.status === 'sent' || existing.status === 'queued') {
        logger.info('Idempotent notification hit, skipping duplicate send', {
          idempotencyKey: request.idempotencyKey,
          deliveryId: existing.id,
          status: existing.status,
        });
        return existing;
      }

      // Existing record has status === 'failed': check bounded retry limit
      if (existing.attempt_count >= this.maxAttempts) {
        logger.warn('Notification bounded retry limit reached, skipping further attempts', {
          idempotencyKey: request.idempotencyKey,
          deliveryId: existing.id,
          attemptCount: existing.attempt_count,
          maxAttempts: this.maxAttempts,
        });
        return existing;
      }

      // Atomically claim the failed record for retry
      if (typeof repo.claimForRetry === 'function') {
        const claimed = await repo.claimForRetry(existing.id, this.maxAttempts);
        if (!claimed) {
          const latest = await repo.findByIdempotencyKey(request.idempotencyKey);
          return latest ?? existing;
        }
        record = claimed;
      } else {
        record = existing;
      }
    } else {
      try {
        record = await repo.create({
          idempotencyKey: request.idempotencyKey,
          templateCode: request.templateCode,
          recipientEmail: request.recipientEmail,
          bookingId: request.bookingId,
          paymentId: request.paymentId,
          payload: request.payload,
          status: 'queued',
        });
      } catch (err) {
        // Handle concurrent duplicate insert (PostgreSQL 23505 unique_violation) without double-sending
        if (isPgUniqueViolation(err)) {
          const concurrent = await repo.findByIdempotencyKey(request.idempotencyKey);
          if (concurrent) {
            logger.info('Concurrent idempotent notification request detected, returning existing record', {
              idempotencyKey: request.idempotencyKey,
              deliveryId: concurrent.id,
            });
            return concurrent;
          }
        }
        throw err;
      }
    }

    // 2. Render subject and body from template (enforces existence and is_active = true)
    let rendered: { subject: string; body: string };
    try {
      rendered = await this.templates.renderTemplate(
        request.templateCode,
        request.payload ?? {},
      );
    } catch (err) {
      if (err instanceof AppError) {
        await repo.markFailed(record.id, err.message);
      }
      throw err;
    }

    // 3. Dispatch email with resilient failure tracking (D-10, CT-22)
    try {
      const transport = getEmailTransport();
      const info = await transport.sendMail({
        to: request.recipientEmail,
        subject: rendered.subject,
        text: rendered.body,
      });

      const updated = await repo.markSent(record.id, info.messageId);
      record.status = 'sent';
      record.provider_message_id = info.messageId ?? null;
      record.last_error = null;
      record.sent_at = updated?.sent_at ?? new Date();
      record.attempt_count = updated?.attempt_count ?? record.attempt_count + 1;
      return updated ?? record;
    } catch (sendErr) {
      const errorMessage = sendErr instanceof Error ? sendErr.message : String(sendErr);
      logger.error('Email delivery failed (recorded for bounded retry per CT-22)', {
        deliveryId: record.id,
        idempotencyKey: request.idempotencyKey,
        recipientEmail: request.recipientEmail,
        error: errorMessage,
      });

      const updated = await repo.markFailed(record.id, errorMessage);
      record.status = 'failed';
      record.last_error = errorMessage;
      record.attempt_count = updated?.attempt_count ?? record.attempt_count + 1;
      return updated ?? record;
    }
  }
}

export const deliveryService = new DeliveryService();
