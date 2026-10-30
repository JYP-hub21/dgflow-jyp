'use client';

import { Minus, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * 생산 수량 입력칸 + 오른쪽에 아주 작은 위(+1) · 아래(−1) 버튼.
 * 2026-10-30 피드백: "매번 숫자를 고쳐 치는 건 귀찮으니 옆에 위아래로 작게 + − 를" · "+1 기능".
 * 폰에서는 숫자 키패드를 띄운다 (type=number 는 스피너가 끼어들고 키패드도 들쭉날쭉하다).
 */
export default function QtyStepper({ value, onChange, size = 'md', invalid, highlight, label = '이번 생산량' }: {
  value: string;
  onChange: (v: string) => void;
  /** md: PC 표(44px) · lg: 폰 카드(48px) */
  size?: 'md' | 'lg';
  invalid?: boolean;
  highlight?: boolean;
  label?: string;
}) {
  const n = parseInt(value) || 0;
  const tall = size === 'lg' ? 'h-12' : 'h-11';
  const step = (d: number) => {
    const next = Math.max(0, n + d);
    onChange(next === 0 ? '' : String(next));
  };
  return (
    <div className={cn('flex shrink-0 items-stretch', tall)}>
      <Input
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="0"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={e => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        className={cn('h-full rounded-r-none text-right font-semibold tabular-nums',
          size === 'lg' ? 'w-20 text-lg' : 'w-24 text-base',
          highlight && !invalid && 'border-brand-600')}
      />
      <div className="flex w-7 flex-col">
        <button type="button" aria-label="하나 더" onClick={() => step(1)}
          className="flex flex-1 items-center justify-center rounded-tr-lg border border-l-0 border-input bg-card text-muted-foreground hover:bg-brand-50 hover:text-brand-800 active:bg-brand-100">
          <Plus className="h-3 w-3" strokeWidth={2.5} />
        </button>
        <button type="button" aria-label="하나 빼기" onClick={() => step(-1)} disabled={n === 0}
          className="flex flex-1 items-center justify-center rounded-br-lg border border-l-0 border-t-0 border-input bg-card text-muted-foreground hover:bg-brand-50 hover:text-brand-800 active:bg-brand-100 disabled:opacity-40">
          <Minus className="h-3 w-3" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
