import { PageContainer } from '@/components/common/PageContainer';

const MODULE_OWNERSHIP = [
  {
    code: 'TV1',
    service: 'core-service (:4001)',
    schema: 'core',
    modules: 'auth, users, roles',
    features: 'auth',
    summary: 'Xác thực, phiên đăng nhập và phân quyền (RBAC)',
  },
  {
    code: 'TV2',
    service: 'core-service (:4001)',
    schema: 'core',
    modules: 'movies, cinemas, auditoriums, seats',
    features: 'movies, cinemas',
    summary: 'Danh mục phim, cụm rạp, phòng chiếu và sơ đồ ghế đôi (D-15)',
  },
  {
    code: 'TV3',
    service: 'core-service (:4001)',
    schema: 'core',
    modules: 'showtimes, pricing, seat-holds',
    features: 'showtimes, seats',
    summary: 'Lịch chiếu (buffer 15p), báo giá vé và giữ/phân bổ ghế nguyên tử (D-05, D-12)',
  },
  {
    code: 'TV4',
    service: 'core-service (:4001) + payment-service (:4002)',
    schema: 'core, payment',
    modules: 'bookings, concessions, tickets | payments, webhooks, refunds',
    features: 'bookings, payments, tickets',
    summary: 'Đặt vé, bắp nước, vé QR và dịch vụ thanh toán giả lập HMAC / hoàn tiền (D-07, D-09)',
  },
  {
    code: 'TV5',
    service: 'core-service (:4001) + notification-service (:4003)',
    schema: 'core, notification',
    modules: 'checkins, reports | email, templates, delivery',
    features: 'checkins, reports, notifications',
    summary: 'Soát vé QR, báo cáo thống kê, dịch vụ gửi email thông báo và điều phối DevOps (D-10)',
  },
] as const;

export function HomePage() {
  return (
    <PageContainer>
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 sm:p-10">
        <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
          Project Scaffolding — 3-Service SOA Monorepo
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">
          Cinema Ticket Booking System
        </h1>
        <p className="mt-3 max-w-2xl text-base text-slate-300">
          Khung ứng dụng đặt vé xem phim trực tuyến (React 19 + Vite + 3 dịch vụ Express 5 độc lập:{' '}
          <code>core-service</code>, <code>payment-service</code>, <code>notification-service</code>{' '}
          + PostgreSQL 17 chia 3 schema + Redis). Chưa triển khai nghiệp vụ chi tiết ở giai đoạn khởi
          tạo.
        </p>
      </section>

      <section aria-labelledby="modules-heading" className="mt-8">
        <h2 id="modules-heading" className="text-lg font-semibold text-slate-100">
          Phân công 5 thành viên (TV1–TV5) trên kiến trúc 3 dịch vụ
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULE_OWNERSHIP.map((item) => (
            <article
              key={item.code}
              className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-amber-400">
                <span>{item.code}</span>
                <code className="text-slate-400">schema: {item.schema}</code>
              </div>
              <h3 className="mt-2 font-mono text-sm font-medium text-slate-100">{item.service}</h3>
              <p className="mt-1 text-xs text-slate-400">
                Backend modules: <code>{item.modules}</code>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Frontend features: <code>{item.features}</code>
              </p>
              <p className="mt-2 text-sm text-slate-300">{item.summary}</p>
            </article>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}

export default HomePage;
