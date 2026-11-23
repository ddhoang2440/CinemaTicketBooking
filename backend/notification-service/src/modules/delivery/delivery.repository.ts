import { randomUUID } from 'node:crypto';
import { getDb } from '../../config/database.js';
import type { DeliveryRecord } from './delivery.types.js';

export interface CreateDeliveryParams {
  idempotencyKey: string;
  templateCode: string;
  recipientEmail: string;
  bookingId?: string;
  paymentId?: string;
  payload?: Record<string, unknown>;
  status?: 'queued' | 'sent' | 'failed';
}

export class DeliveryRepository {
  async findByIdempotencyKey(key: string): Promise<DeliveryRecord | null> {
    const db = getDb();
    const row = await db<DeliveryRecord>('notification_deliveries')
      .where({ idempotency_key: key })
      .first();
    return row ?? null;
  }

  async create(params: CreateDeliveryParams): Promise<DeliveryRecord> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date();

    const [created] = await db<DeliveryRecord>('notification_deliveries')
      .insert({
        id,
        idempotency_key: params.idempotencyKey,
        template_code: params.templateCode,
        recipient_email: params.recipientEmail,
        booking_id: params.bookingId ?? null,
        payment_id: params.paymentId ?? null,
        payload: params.payload ?? {},
        status: params.status ?? 'queued',
        attempt_count: 0,
        provider_message_id: null,
        last_error: null,
        sent_at: null,
        created_at: now,
        updated_at: now,
      })
      .returning('*');

    if (!created) {
      throw new Error('Failed to create notification delivery record');
    }

    return created;
  }

  /**
   * Atomically claims a failed delivery record for bounded retry if attempt_count < maxAttempts.
   * Prevents duplicate concurrent retries from both dispatching an email.
   */
  async claimForRetry(id: string, maxAttempts: number): Promise<DeliveryRecord | null> {
    const db = getDb();
    const now = new Date();
    const [claimed] = await db<DeliveryRecord>('notification_deliveries')
      .where({ id, status: 'failed' })
      .andWhere('attempt_count', '<', maxAttempts)
      .update({
        status: 'queued',
        updated_at: now,
      })
      .returning('*');
    return claimed ?? null;
  }

  async markSent(id: string, providerMessageId?: string | null): Promise<DeliveryRecord> {
    const db = getDb();
    const now = new Date();
    const [updated] = await db<DeliveryRecord>('notification_deliveries')
      .where({ id })
      .update({
        status: 'sent',
        provider_message_id: providerMessageId ?? null,
        last_error: null,
        sent_at: now,
        updated_at: now,
        attempt_count: db.raw('attempt_count + 1') as unknown as number,
      })
      .returning('*');

    if (!updated) {
      throw new Error(`Delivery record '${id}' not found when marking sent`);
    }
    return updated;
  }

  async markFailed(id: string, errorMessage: string): Promise<DeliveryRecord> {
    const db = getDb();
    const now = new Date();
    const [updated] = await db<DeliveryRecord>('notification_deliveries')
      .where({ id })
      .update({
        status: 'failed',
        last_error: errorMessage,
        updated_at: now,
        attempt_count: db.raw('attempt_count + 1') as unknown as number,
      })
      .returning('*');

    if (!updated) {
      throw new Error(`Delivery record '${id}' not found when marking failed`);
    }
    return updated;
  }
}

let activeDeliveryRepository: DeliveryRepository = new DeliveryRepository();

export function setDeliveryRepository(repo: DeliveryRepository | null): void {
  activeDeliveryRepository = repo ?? new DeliveryRepository();
}

export function getDeliveryRepository(): DeliveryRepository {
  return activeDeliveryRepository;
}

export const deliveryRepository = new DeliveryRepository();
