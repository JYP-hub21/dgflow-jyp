import { cn } from '@/lib/utils';

/**
 * 여럿 중 하나를 고르는 칩 (차수 시트 · 포장 분리 방식 · 포장 탭).
 * 예전 칩은 12px 글씨에 고른 것도 연한 하늘색이라 무엇이 골라져 있는지 안 보였다.
 * 고른 칩은 남색으로 꽉 채워 한눈에 구분되게 한다.
 */
export function chipClass(active: boolean, className?: string) {
  return cn(
    'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-all',
    'disabled:pointer-events-none disabled:opacity-40',
    active
      ? 'border-brand-800 bg-brand-800 text-white shadow-sm shadow-brand-900/20'
      : 'border-input bg-card text-foreground shadow-xs hover:border-brand-600/50 hover:bg-brand-50',
    className,
  );
}

/** 칩 안의 보조 숫자 (행 수 · 장 수) */
export function chipCountClass(active: boolean) {
  return cn('text-xs font-medium', active ? 'text-white/70' : 'text-muted-foreground');
}
