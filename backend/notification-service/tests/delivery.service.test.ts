import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DeliveryService } from '../src/modules/delivery/delivery.service.js';
import type {
  DeliveryRepository,
  CreateDeliveryParams,
} from '../src/modules/delivery/delivery.repository.js';
import {
  setEmailTransport,
  type EmailTransport,
  type SendMailOptions,
} from '../src/modules/email/email.transport.js';
import type { DeliveryRecord } from '../src/modules/delivery/delivery.types.js';

describe('Notification Service — Delivery Service & Resilience (CT-22)', () => {
  let mockTransport: EmailTransport;
  let mockRepo: DeliveryRepository;
  let inMemoryDeliveries: Map<string, DeliveryRecord>;
  let sendMailCalls: SendMailOptions[];

  beforeEach(() => {
    inMemoryDeliveries = new Map();
    sendMailCalls = [];

    mockTransport = {
      sendMail: vi.fn(async (options: SendMailOptions) => {
        sendMailCalls.push(options);
        return { messageId: 'msg-' + Math.random().toString(36).substring(2, 9) };
      }),
    };
    setEmailTransport(mockTransport);

    mockRepo = {
      findByIdempotencyKey: vi.fn(async (key: string) => inMemoryDeliveries.get(key) ?? null),
      create: vi.fn(async (params: CreateDeliveryParams): Promise<DeliveryRecord> => {
        const record: DeliveryRecord = {
          id: 'del-' + Math.random().toString(36).substring(2, 9),
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
          created_at: new Date(),
          updated_at: new Date(),
        };
        inMemoryDeliveries.set(params.idempotencyKey, record);
        return record;
      }),
      markSent: vi.fn(async (id: string) => {
        for (const record of inMemoryDeliveries.values()) {
          if (record.id === id) {
            record.status = 'sent';
            record.sent_at = new Date();
          }
        }
      }),
      markFailed: vi.fn(async (id: string, errorMessage: string) => {
        for (const record of inMemoryDeliveries.values()) {
          if (record.id === id) {
            record.status = 'failed';
            record.last_error = errorMessage;
          }
        }
      }),
    } as unknown as DeliveryRepository;
  });

  it('dispatches email and updates delivery record to sent', async () => {
    const service = new DeliveryService(mockRepo);

    const record = await service.processNotification({
      idempotencyKey: 'idemp-test-001',
      templateCode: 'booking_confirmed',
      recipientEmail: 'customer@example.com',
      payload: {
        name: 'Nguyễn Văn A',
        bookingCode: 'BKG-001',
        movieTitle: 'Inception',
      },
    });

    expect(record.status).toBe('sent');
    expect(record.recipient_email).toBe('customer@example.com');
    expect(sendMailCalls).toHaveLength(1);
    expect(sendMailCalls[0]?.to).toBe('customer@example.com');
  });

  it('returns existing record on duplicate idempotencyKey without resending email', async () => {
    const service = new DeliveryService(mockRepo);

    const first = await service.processNotification({
      idempotencyKey: 'idemp-duplicate-test',
      templateCode: 'ticket_issued',
      recipientEmail: 'ticket@example.com',
      payload: {
        name: 'Võ Minh Huy',
        ticketCode: 'TCK-888',
      },
    });

    expect(first.status).toBe('sent');
    expect(sendMailCalls).toHaveLength(1);

    // Second call with same idempotencyKey
    const second = await service.processNotification({
      idempotencyKey: 'idemp-duplicate-test',
      templateCode: 'ticket_issued',
      recipientEmail: 'ticket@example.com',
      payload: {
        name: 'Võ Minh Huy',
        ticketCode: 'TCK-888',
      },
    });

    expect(second.id).toBe(first.id);
    expect(second.status).toBe('sent');
    // Ensure email was not sent a second time
    expect(sendMailCalls).toHaveLength(1);
  });

  it('CT-22: handles email transport failure gracefully without throwing unhandled error', async () => {
    // Setup transport failure
    mockTransport.sendMail = vi.fn(async () => {
      throw new Error('SMTP connection timed out');
    });

    const service = new DeliveryService(mockRepo);

    const record = await service.processNotification({
      idempotencyKey: 'idemp-failure-test',
      templateCode: 'email_verification',
      recipientEmail: 'fail@example.com',
      payload: {
        name: 'Test User',
        verificationCode: '123456',
      },
    });

    // Does NOT throw; records status failed
    expect(record.status).toBe('failed');
    expect(record.last_error).toBe('SMTP connection timed out');
    expect(record.attempt_count).toBe(1);
  });
});
