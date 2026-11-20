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
        last_error: null,
        sent_at: null,
        created_at: now,
        updated_at: now,
      })
      .returning('*');

    return (
      created ?? {
        id,
        idempotency_key: params.idempotencyKey,
        template_code: params.templateCode,
        recipient_email: params.recipientEmail,
        booking_id: params.bookingId ?? null,
        payment_id: params.paymentId ?? null,
        payload: params.payload ?? {},
        status: params.status ?? 'queued',
        attempt_count: 0,
        last_error: null,
        sent_at: null,
        created_at: now,
        updated_at: now,
      }
    );
  }

  async markSent(id: string): Promise<void> {
    const db = getDb();
    const now = new Date();
    await db('notification_deliveries')
      .where({ id })
      .update({
        status: 'sent',
        sent_at: now,
        updated_at: now,
        attempt_count: db.raw('attempt_count + 1'),
      });
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    const db = getDb();
    const now = new Date();
    await db('notification_deliveries')
      .where({ id })
      .update({
        status: 'failed',
        last_error: errorMessage,
        updated_at: now,
        attempt_count: db.raw('attempt_count + 1'),
      });
  }
}

export const deliveryRepository = new DeliveryRepository();
