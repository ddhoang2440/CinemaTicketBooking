import { z } from 'zod';

export const sendNotificationRequestSchema = z.object({
  templateCode: z.enum([
    'email_verification',
    'booking_confirmed',
    'ticket_issued',
    'booking_cancelled',
    'refund_processed',
  ]),
  recipientEmail: z.string().email('Invalid email address format'),
  bookingId: z.string().uuid('Invalid booking UUID').optional(),
  paymentId: z.string().uuid('Invalid payment UUID').optional(),
  payload: z.record(z.unknown()).optional().default({}),
  idempotencyKey: z.string().min(8, 'idempotencyKey must be at least 8 characters long'),
});

export type SendNotificationRequest = z.infer<typeof sendNotificationRequestSchema>;

export interface DeliveryRecord {
  id: string;
  idempotency_key: string;
  template_code: string;
  recipient_email: string;
  booking_id: string | null;
  payment_id: string | null;
  payload: Record<string, unknown>;
  status: 'queued' | 'sent' | 'failed';
  attempt_count: number;
  last_error: string | null;
  sent_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}
