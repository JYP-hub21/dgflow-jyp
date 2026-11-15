'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/** DG 프리즘 표시 — 단정한 삼각 프리즘 하나. 색은 파랑에서 청록으로 번지는 빛 (ERP 화면 · 대화창 · 메뉴가 같이 쓴다) */
export default function PrismMark({ small, className }: { small?: boolean; className?: string }) {
  const id = useId();
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-xl bg-brand-50 ring-1 ring-inset ring-brand-600/15',
      small ? 'h-7 w-7 rounded-lg' : 'h-10 w-10', className)}>
      <svg viewBox="0 0 24 24" className={small ? 'h-4 w-4' : 'h-[22px] w-[22px]'} aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3182F6" />
            <stop offset="1" stopColor="#14B8A6" />
          </linearGradient>
        </defs>
        <path d="M12 3 L21 19.5 H3 Z" fill={`url(#${id})`} stroke={`url(#${id})`} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M12 10 L15.4 16.3 H8.6 Z" fill="#fff" fillOpacity="0.85" />
      </svg>
    </span>
  );
}
