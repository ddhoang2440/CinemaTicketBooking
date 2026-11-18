import { Film } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-slate-50"
          >
            <Film className="h-6 w-6 text-amber-400" aria-hidden="true" />
            <span>Cinema Ticket Booking System</span>
          </Link>
          <nav aria-label="Điều hướng chính" className="flex items-center gap-4 text-sm text-slate-300">
            <Link to="/" className="transition-colors hover:text-amber-400">
              Trang chủ
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-800 bg-slate-900/50 py-6 text-center text-xs text-slate-400">
        <div className="mx-auto max-w-6xl px-4">
          Hệ thống Đặt vé Xem phim — Kiến trúc hướng dịch vụ (SOA) • Múi giờ hiển thị:{' '}
          <code>Asia/Ho_Chi_Minh</code> • Đơn vị tiền tệ: <code>VND</code>
        </div>
      </footer>
    </div>
  );
}

