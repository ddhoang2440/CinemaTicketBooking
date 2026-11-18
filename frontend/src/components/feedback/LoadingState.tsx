export interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Đang tải dữ liệu...' }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-300"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-amber-400" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

