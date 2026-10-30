'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LINES, type ProductionLine } from '@/lib/production/lines';

/** 화면마다 다시 받지 않게 한 번 받은 목록을 들고 있는다 (편집하면 reload) */
let cache: { storage: 'db' | 'none'; lines: ProductionLine[] } | null = null;

/** 생산 라인(호기) 목록 — 받기 전에는 1호기 · 2호기 */
export function useProductionLines() {
  const [state, setState] = useState(cache ?? { storage: 'none' as const, lines: DEFAULT_LINES });
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/production/lines', { cache: 'no-store' });
      if (!res.ok) return;
      cache = await res.json();
      setState(cache!);
    } catch { /* 못 받으면 기본값으로 둔다 */ }
  }, []);
  useEffect(() => { if (!cache) void reload(); }, [reload]);
  return { ...state, reload };
}
