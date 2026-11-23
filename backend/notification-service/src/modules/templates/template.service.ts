import { getDb } from '../../config/database.js';
import { AppError } from '../../common/errors/AppError.js';

export interface RenderedTemplate {
  subject: string;
  body: string;
}

export interface TemplateRecord {
  id?: string;
  code: string;
  subject_template: string;
  body_template: string;
  is_active: boolean;
}

export interface TemplateRepository {
  findByCode(code: string): Promise<TemplateRecord | null>;
}

export class DatabaseTemplateRepository implements TemplateRepository {
  async findByCode(code: string): Promise<TemplateRecord | null> {
    const db = getDb();
    const row = await db<TemplateRecord>('notification_templates').where({ code }).first();
    return row ?? null;
  }
}

export const DEFAULT_TEMPLATES: Record<string, TemplateRecord> = {
  email_verification: {
    code: 'email_verification',
    subject_template: '[Cinema] Xác thực tài khoản của bạn',
    body_template:
      'Xin chào {{name}},\n\nMã xác thực tài khoản của bạn là: {{verificationCode}}\nMã này có hiệu lực trong vòng 15 phút.\n\nTrân trọng,\nCinema Ticket Booking Team',
    is_active: true,
  },
  booking_confirmed: {
    code: 'booking_confirmed',
    subject_template: '[Cinema] Xác nhận đặt vé thành công - Đơn hàng #{{bookingCode}}',
    body_template:
      'Xin chào {{name}},\n\nBạn đã đặt vé thành công cho phim "{{movieTitle}}" tại {{cinemaName}}.\n- Mã đơn hàng: {{bookingCode}}\n- Suất chiếu: {{showtime}}\n- Phòng chiếu: {{auditoriumName}}\n- Ghế: {{seatLabels}}\n- Tổng tiền: {{totalVnd}} VNĐ\n\nCảm ơn bạn đã lựa chọn dịch vụ của chúng tôi!',
    is_active: true,
  },
  ticket_issued: {
    code: 'ticket_issued',
    subject_template: '[Cinema] Vé điện tử kèm mã QR - Đơn hàng #{{bookingCode}}',
    body_template:
      'Xin chào {{name}},\n\nVé điện tử của bạn đã sẵn sàng!\n- Phim: {{movieTitle}}\n- Rạp: {{cinemaName}}\n- Suất chiếu: {{showtime}}\n- Ghế: {{seatLabels}}\n- Mã vé: {{ticketCode}}\n\nVui lòng xuất trình mã QR đính kèm khi đến rạp để làm thủ tục check-in.\n\nChúc bạn xem phim vui vẻ!',
    is_active: true,
  },
  booking_cancelled: {
    code: 'booking_cancelled',
    subject_template: '[Cinema] Thông báo hủy đặt vé - Đơn hàng #{{bookingCode}}',
    body_template:
      'Xin chào {{name}},\n\nĐơn đặt vé #{{bookingCode}} cho phim "{{movieTitle}}" đã được hủy thành công theo chính sách của rạp.\n\nTrân trọng,\nCinema Ticket Booking Team',
    is_active: true,
  },
  refund_processed: {
    code: 'refund_processed',
    subject_template: '[Cinema] Xác nhận hoàn tiền - Đơn hàng #{{bookingCode}}',
    body_template:
      'Xin chào {{name}},\n\nYêu cầu hoàn tiền cho đơn hàng #{{bookingCode}} đã được xử lý.\n- Số tiền hoàn lại: {{refundAmountVnd}} VNĐ\n\nTrân trọng,\nCinema Ticket Booking Team',
    is_active: true,
  },
};

let activeTemplateRepository: TemplateRepository = new DatabaseTemplateRepository();

export function setTemplateRepository(repo: TemplateRepository | null): void {
  activeTemplateRepository = repo ?? new DatabaseTemplateRepository();
}

export function getTemplateRepository(): TemplateRepository {
  return activeTemplateRepository;
}

export class TemplateService {
  constructor(private readonly repo?: TemplateRepository) {}

  private getRepository(): TemplateRepository {
    return this.repo ?? getTemplateRepository();
  }

  /**
   * Substitutes {{placeholder}} tokens with values from payload.
   */
  public renderText(template: string, payload: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
      if (key in payload && payload[key] !== undefined && payload[key] !== null) {
        return String(payload[key]);
      }
      return '';
    });
  }

  /**
   * Loads template from repository, enforces existence and is_active = true, then renders subject and body.
   * Never falls back silently when database fails or when a template is disabled (is_active = false).
   */
  public async renderTemplate(
    templateCode: string,
    payload: Record<string, unknown> = {},
  ): Promise<RenderedTemplate> {
    const templateRecord = await this.getRepository().findByCode(templateCode);

    if (!templateRecord) {
      throw new AppError(
        404,
        'TEMPLATE_NOT_FOUND',
        `Notification template '${templateCode}' was not found`,
      );
    }

    if (!templateRecord.is_active) {
      throw new AppError(
        422,
        'TEMPLATE_DISABLED',
        `Notification template '${templateCode}' is disabled`,
      );
    }

    return {
      subject: this.renderText(templateRecord.subject_template, payload),
      body: this.renderText(templateRecord.body_template, payload),
    };
  }
}

export const templateService = new TemplateService();
