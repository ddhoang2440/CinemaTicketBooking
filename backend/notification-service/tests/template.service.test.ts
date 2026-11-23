import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  TemplateService,
  type TemplateRecord,
} from '../src/modules/templates/template.service.js';

describe('Notification Service — Template Rendering', () => {
  let templates: Map<string, TemplateRecord>;
  let templateService: TemplateService;

  beforeEach(() => {
    templates = new Map(Object.entries(DEFAULT_TEMPLATES).map(([k, v]) => [k, { ...v }]));
    templateService = new TemplateService({
      findByCode: async (code: string) => templates.get(code) ?? null,
    });
  });

  it('renders placeholders in text templates', () => {
    const raw = 'Hello {{name}}, your code is {{code}} for film {{movieTitle}}.';
    const result = templateService.renderText(raw, {
      name: 'Võ Minh Huy',
      code: 'CIN-12345',
      movieTitle: 'Dune 2',
    });

    expect(result).toBe('Hello Võ Minh Huy, your code is CIN-12345 for film Dune 2.');
  });

  it('handles missing variables gracefully with empty string', () => {
    const raw = 'Hello {{name}}, your seat is {{seat}}!';
    const result = templateService.renderText(raw, {
      name: 'Võ Minh Huy',
    });

    expect(result).toBe('Hello Võ Minh Huy, your seat is !');
  });

  it('renders standard booking_confirmed template', async () => {
    const rendered = await templateService.renderTemplate('booking_confirmed', {
      name: 'Nguyễn Văn A',
      movieTitle: 'Avengers',
      cinemaName: 'Cinema Quận 1',
      bookingCode: 'BKG-9999',
      showtime: '2026-11-20 19:30',
      auditoriumName: 'Rạp 01',
      seatLabels: 'F10, F11',
      totalVnd: '180,000',
    });

    expect(rendered.subject).toContain('BKG-9999');
    expect(rendered.body).toContain('Avengers');
    expect(rendered.body).toContain('Cinema Quận 1');
    expect(rendered.body).toContain('F10, F11');
  });

  it('renders email_verification template', async () => {
    const rendered = await templateService.renderTemplate('email_verification', {
      name: 'Khánh',
      verificationCode: '883921',
    });

    expect(rendered.subject).toContain('Xác thực tài khoản');
    expect(rendered.body).toContain('883921');
  });

  it('throws TEMPLATE_DISABLED when template has is_active = false', async () => {
    templates.set('booking_confirmed', {
      ...DEFAULT_TEMPLATES.booking_confirmed!,
      is_active: false,
    });

    await expect(
      templateService.renderTemplate('booking_confirmed', { name: 'Test' }),
    ).rejects.toThrow(/disabled/);
  });

  it('throws TEMPLATE_NOT_FOUND when template does not exist', async () => {
    await expect(
      templateService.renderTemplate('non_existent_code', { name: 'Test' }),
    ).rejects.toThrow(/not found/);
  });
});
