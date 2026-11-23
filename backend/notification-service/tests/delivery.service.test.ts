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
import {
  DEFAULT_TEMPLATES,
  TemplateService,
  type TemplateRecord,
} from '../src/modules/templates/template.service.js';

describe('Notification Service — Delivery Service & Resilience (CT-22)', () => {
  let mockTransport: EmailTransport;
  let mockRepo: DeliveryRepository;
  let mockTemplates: Map<string, TemplateRecord>;
  let testTemplateService: TemplateService;
  let inMemoryDeliveries: Map<string, DeliveryRecord>;
  let sendMailCalls: SendMailOptions[];

  beforeEach(() => {
    inMemoryDeliveries = new Map();
    sendMailCalls = [];
    mockTemplates = new Map(
      Object.entries(DEFAULT_TEMPLATES).map(([k, v]) => [k, { ...v }]),
    );

    testTemplateService = new TemplateService({
      findByCode: vi.fn(async (code: string) => mockTemplates.get(code) ?? null),
    });

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
        if (inMemoryDeliveries.has(params.idempotencyKey)) {
          const dupErr = new Error('duplicate key value violates unique constraint') as Error & {
            code: string;
          };
          dupErr.code = '23505';
          throw dupErr;
        }
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
          provider_message_id: null,
          last_error: null,
          sent_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        inMemoryDeliveries.set(params.idempotencyKey, record);
        return record;
      }),
      claimForRetry: vi.fn(async (id: string, maxAttempts: number) => {
        for (const record of inMemoryDeliveries.values()) {
          if (record.id === id && record.status === 'failed' && record.attempt_count < maxAttempts) {
            record.status = 'queued';
            return record;
          }
        }
        return null;
      }),
      markSent: vi.fn(async (id: string, providerMessageId?: string | null) => {
        for (const record of inMemoryDeliveries.values()) {
          if (record.id === id) {
            record.status = 'sent';
            record.provider_message_id = providerMessageId ?? null;
            record.last_error = null;
            record.sent_at = new Date();
            record.attempt_count += 1;
            return record;
          }
        }
        throw new Error('Record not found');
      }),
      markFailed: vi.fn(async (id: string, errorMessage: string) => {
        for (const record of inMemoryDeliveries.values()) {
          if (record.id === id) {
            record.status = 'failed';
            record.last_error = errorMessage;
            record.attempt_count += 1;
            return record;
          }
        }
        throw new Error('Record not found');
      }),
    };
  });

  it('dispatches email, persists provider_message_id, and updates delivery record to sent', async () => {
    const service = new DeliveryService(mockRepo, testTemplateService);

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
    expect(record.provider_message_id).toMatch(/^msg-/);
    expect(record.attempt_count).toBe(1);
    expect(sendMailCalls).toHaveLength(1);
    expect(sendMailCalls[0]?.to).toBe('customer@example.com');
  });

  it('returns existing record on duplicate idempotencyKey without resending email', async () => {
    const service = new DeliveryService(mockRepo, testTemplateService);

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
    expect(sendMailCalls).toHaveLength(1);
  });

  it('CT-22: handles email transport failure gracefully and enforces bounded retry (maxAttempts = 3)', async () => {
    mockTransport.sendMail = vi.fn(async () => {
      throw new Error('SMTP connection timed out');
    });

    const service = new DeliveryService(mockRepo, testTemplateService, { maxAttempts: 3 });
    const req = {
      idempotencyKey: 'idemp-failure-test',
      templateCode: 'email_verification' as const,
      recipientEmail: 'fail@example.com',
      payload: {
        name: 'Test User',
        verificationCode: '123456',
      },
    };

    // Attempt 1
    const attempt1 = await service.processNotification(req);
    expect(attempt1.status).toBe('failed');
    expect(attempt1.last_error).toBe('SMTP connection timed out');
    expect(attempt1.attempt_count).toBe(1);

    // Attempt 2
    const attempt2 = await service.processNotification(req);
    expect(attempt2.status).toBe('failed');
    expect(attempt2.attempt_count).toBe(2);

    // Attempt 3
    const attempt3 = await service.processNotification(req);
    expect(attempt3.status).toBe('failed');
    expect(attempt3.attempt_count).toBe(3);

    // Attempt 4 -> bounded retry exhausted, transport.sendMail must NOT be called a 4th time
    const attempt4 = await service.processNotification(req);
    expect(attempt4.status).toBe('failed');
    expect(attempt4.attempt_count).toBe(3);
    expect(mockTransport.sendMail).toHaveBeenCalledTimes(3);
  });

  it('does not fabricate an in-memory record when database persistence fails', async () => {
    mockRepo.findByIdempotencyKey = vi.fn(async () => {
      throw new Error('Database connection refused');
    });

    const service = new DeliveryService(mockRepo, testTemplateService);
    await expect(
      service.processNotification({
        idempotencyKey: 'idemp-db-down',
        templateCode: 'booking_confirmed',
        recipientEmail: 'customer@example.com',
        payload: {},
      }),
    ).rejects.toThrow('Database connection refused');
  });

  it('rejects disabled templates (is_active = false) without sending email', async () => {
    mockTemplates.set('booking_confirmed', {
      ...DEFAULT_TEMPLATES.booking_confirmed!,
      is_active: false,
    });

    const service = new DeliveryService(mockRepo, testTemplateService);
    await expect(
      service.processNotification({
        idempotencyKey: 'idemp-disabled-template',
        templateCode: 'booking_confirmed',
        recipientEmail: 'customer@example.com',
        payload: {},
      }),
    ).rejects.toThrow(/disabled/);

    expect(sendMailCalls).toHaveLength(0);
  });
});
