import { cn } from '@/lib/utils';

/** 진행률 막대 — 다 끝나면 초록으로 바꿔 한눈에 구분되게 한다 */
export default function Progress({ value, className, showLabel = true }: {
  value: number;
  className?: string;
  showLabel?: boolean;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-border/80">
        <div
          className={cn('h-full rounded-full transition-all', v >= 100 ? 'bg-success' : 'bg-brand-600')}
          style={{ width: `${v}%` }}
        />
      </div>
      {showLabel && (
        <span className={cn('tabular w-10 shrink-0 text-right text-xs font-semibold',
          v >= 100 ? 'text-success' : 'text-foreground')}>
          {v}%
        </span>
      )}
    </div>
  );
}
