import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Đã xảy ra lỗi',
  message = 'Không thể tải dữ liệu. Vui lòng thử lại sau.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-red-900/60 bg-red-950/30 p-8 text-center"
    >
      <AlertTriangle className="h-8 w-8 text-red-400" aria-hidden="true" />
      <h2 className="text-base font-semibold text-red-200">{title}</h2>
      <p className="max-w-md text-sm text-red-300/90">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Thử lại
        </Button>
      ) : null}
    </div>
  );
}

