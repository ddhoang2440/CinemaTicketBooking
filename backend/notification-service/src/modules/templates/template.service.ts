import { getDb } from '../../config/database.js';

export interface RenderedTemplate {
  subject: string;
  body: string;
}

const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string }> = {
  email_verification: {
    subject: '[Cinema] Xác thực tài khoản của bạn',
    body: 'Xin chào {{name}},\n\nMã xác thực tài khoản của bạn là: {{verificationCode}}\nMã này có hiệu lực trong vòng 15 phút.\n\nTrân trọng,\nCinema Ticket Booking Team',
  },
  booking_confirmed: {
    subject: '[Cinema] Xác nhận đặt vé thành công - Đơn hàng #{{bookingCode}}',
    body: 'Xin chào {{name}},\n\nBạn đã đặt vé thành công cho phim "{{movieTitle}}" tại {{cinemaName}}.\n- Mã đơn hàng: {{bookingCode}}\n- Suất chiếu: {{showtime}}\n- Phòng chiếu: {{auditoriumName}}\n- Ghế: {{seatLabels}}\n- Tổng tiền: {{totalVnd}} VNĐ\n\nCảm ơn bạn đã lựa chọn dịch vụ của chúng tôi!',
  },
  ticket_issued: {
    subject: '[Cinema] Vé điện tử kèm mã QR - Đơn hàng #{{bookingCode}}',
    body: 'Xin chào {{name}},\n\nVé điện tử của bạn đã sẵn sàng!\n- Phim: {{movieTitle}}\n- Rạp: {{cinemaName}}\n- Suất chiếu: {{showtime}}\n- Ghế: {{seatLabels}}\n- Mã vé: {{ticketCode}}\n\nVui lòng xuất trình mã QR đính kèm khi đến rạp để làm thủ tục check-in.\n\nChúc bạn xem phim vui vẻ!',
  },
  booking_cancelled: {
    subject: '[Cinema] Thông báo hủy đặt vé - Đơn hàng #{{bookingCode}}',
    body: 'Xin chào {{name}},\n\nĐơn đặt vé #{{bookingCode}} cho phim "{{movieTitle}}" đã được hủy thành công theo chính sách của rạp.\n\nTrân trọng,\nCinema Ticket Booking Team',
  },
  refund_processed: {
    subject: '[Cinema] Xác nhận hoàn tiền - Đơn hàng #{{bookingCode}}',
    body: 'Xin chào {{name}},\n\nYêu cầu hoàn tiền cho đơn hàng #{{bookingCode}} đã được xử lý.\n- Số tiền hoàn lại: {{refundAmountVnd}} VNĐ\n\nTrân trọng,\nCinema Ticket Booking Team',
  },
};

export class TemplateService {
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
   * Loads template from database or fallback defaults, then renders subject and body.
   */
  public async renderTemplate(
    templateCode: string,
    payload: Record<string, unknown> = {},
  ): Promise<RenderedTemplate> {
    const db = getDb();
    let templateRecord = null;

    try {
      templateRecord = await db('notification_templates')
        .where({ code: templateCode, is_active: true })
        .first();
    } catch {
      // If database is not ready or seeded yet, fallback to default templates
      templateRecord = null;
    }

    const subjectTemplate =
      templateRecord?.subject_template ??
      DEFAULT_TEMPLATES[templateCode]?.subject ??
      `[Cinema] Thông báo: ${templateCode}`;
    const bodyTemplate =
      templateRecord?.body_template ??
      DEFAULT_TEMPLATES[templateCode]?.body ??
      'Xin chào,\n\nBạn có một thông báo mới từ hệ thống Cinema Booking.\n\nTrân trọng!';

    return {
      subject: this.renderText(subjectTemplate, payload),
      body: this.renderText(bodyTemplate, payload),
    };
  }
}

export const templateService = new TemplateService();
