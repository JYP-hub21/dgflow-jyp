'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 비고(유리 위치) — 표 맨 오른쪽 칸 (종이 작업의뢰서와 같은 자리, 2026-11-02 사용자).
 * 비고는 길 때가 많아서 두 줄까지만 보이고, 누르면 전체가 펼쳐진다. 마우스를 올려도 전체 글이 뜬다.
 */
export default function RemarkText({ text, lines = 2, className }: { text?: string | null; lines?: 2 | 3; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <button type="button" title={text} onClick={() => setOpen(v => !v)} aria-expanded={open}
      className={cn('block w-full text-left text-[13px] leading-snug text-foreground/80 break-keep [overflow-wrap:anywhere] hover:text-foreground',
        !open && (lines === 3 ? 'line-clamp-3' : 'line-clamp-2'), className)}>
      {text}
    </button>
  );
}
