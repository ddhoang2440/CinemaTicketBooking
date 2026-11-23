import type { Knex } from 'knex';

/**
 * TV5 — Idempotent Notification Templates Seed Data (OP-02 / SCRUM-22)
 * Initial email templates for auth, booking, tickets, cancellation, and refunds.
 */
export const TEMPLATE_SEEDS = [
  {
    id: '80000000-0000-4000-8000-000000000001',
    code: 'email_verification',
    subject_template: '[Cinema] Xác thực tài khoản của bạn',
    body_template:
      'Xin chào {{name}},\n\nMã xác thực tài khoản của bạn là: {{verificationCode}}\nMã này có hiệu lực trong vòng 15 phút.\n\nTrân trọng,\nCinema Ticket Booking Team',
    is_active: true,
  },
  {
    id: '80000000-0000-4000-8000-000000000002',
    code: 'booking_confirmed',
    subject_template: '[Cinema] Xác nhận đặt vé thành công - Đơn hàng #{{bookingCode}}',
    body_template:
      'Xin chào {{name}},\n\nBạn đã đặt vé thành công cho phim "{{movieTitle}}" tại {{cinemaName}}.\n- Mã đơn hàng: {{bookingCode}}\n- Suất chiếu: {{showtime}}\n- Phòng chiếu: {{auditoriumName}}\n- Ghế: {{seatLabels}}\n- Tổng tiền: {{totalVnd}} VNĐ\n\nCảm ơn bạn đã lựa chọn dịch vụ của chúng tôi!',
    is_active: true,
  },
  {
    id: '80000000-0000-4000-8000-000000000003',
    code: 'ticket_issued',
    subject_template: '[Cinema] Vé điện tử kèm mã QR - Đơn hàng #{{bookingCode}}',
    body_template:
      'Xin chào {{name}},\n\nVé điện tử của bạn đã sẵn sàng!\n- Phim: {{movieTitle}}\n- Rạp: {{cinemaName}}\n- Suất chiếu: {{showtime}}\n- Ghế: {{seatLabels}}\n- Mã vé: {{ticketCode}}\n\nVui lòng xuất trình mã QR đính kèm khi đến rạp để làm thủ tục check-in.\n\nChúc bạn xem phim vui vẻ!',
    is_active: true,
  },
  {
    id: '80000000-0000-4000-8000-000000000004',
    code: 'booking_cancelled',
    subject_template: '[Cinema] Thông báo hủy đặt vé - Đơn hàng #{{bookingCode}}',
    body_template:
      'Xin chào {{name}},\n\nĐơn đặt vé #{{bookingCode}} cho phim "{{movieTitle}}" đã được hủy thành công theo chính sách của rạp.\n\nTrân trọng,\nCinema Ticket Booking Team',
    is_active: true,
  },
  {
    id: '80000000-0000-4000-8000-000000000005',
    code: 'refund_processed',
    subject_template: '[Cinema] Xác nhận hoàn tiền - Đơn hàng #{{bookingCode}}',
    body_template:
      'Xin chào {{name}},\n\nYêu cầu hoàn tiền cho đơn hàng #{{bookingCode}} đã được xử lý.\n- Số tiền hoàn lại: {{refundAmountVnd}} VNĐ\n\nTrân trọng,\nCinema Ticket Booking Team',
    is_active: true,
  },
] as const;

export async function seed(knex: Knex): Promise<void> {
  await knex
    .withSchema('notification')
    .into('notification_templates')
    .insert([...TEMPLATE_SEEDS])
    .onConflict('code')
    .merge({
      subject_template: knex.raw('excluded.subject_template'),
      body_template: knex.raw('excluded.body_template'),
      is_active: knex.raw('excluded.is_active'),
      updated_at: knex.fn.now(),
    });
}
