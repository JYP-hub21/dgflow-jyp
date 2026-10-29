'use client';

import { cn } from '@/lib/utils';

/**
 * 두세 개 중 하나를 고르는 값(주/야간 · 호기 · 보기 방식)은 드롭다운 대신 눌러 고르는 버튼으로.
 * 무엇이 골라져 있는지 펼치지 않아도 보이고, 공장 폰에서도 한 번에 누른다.
 */
export default function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ElementType }[];
  className?: string;
}) {
  return (
    <div className={cn('inline-flex rounded-lg border border-input bg-muted/70 p-1', className)}>
      {options.map((o) => {
        const Icon = o.icon;
        const on = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={on}
            className={cn(
              'flex h-9 min-w-16 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-all',
              on ? 'bg-brand-800 text-white shadow-sm' : 'text-foreground/70 hover:bg-card hover:text-foreground'
            )}>
            {Icon && <Icon className="h-4 w-4" />}{o.label}
          </button>
        );
      })}
    </div>
  );
}
