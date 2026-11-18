import { Link } from 'react-router-dom';
import { PageContainer } from '@/components/common/PageContainer';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <PageContainer className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">Lỗi 404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-50">
        Không tìm thấy trang yêu cầu
      </h1>
      <p className="mt-3 max-w-md text-sm text-slate-400">
        Đường dẫn bạn truy cập không tồn tại hoặc chức năng đang trong giai đoạn khởi tạo khung dự án.
      </p>
      <div className="mt-6">
        <Link to="/">
          <Button>Quay về trang chủ</Button>
        </Link>
      </div>
    </PageContainer>
  );
}

