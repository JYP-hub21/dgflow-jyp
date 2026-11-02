'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OutsourcePartner } from '@/lib/work-order/site';

/** 화면마다 다시 받지 않게 한 번 받은 목록을 들고 있는다 (더하거나 고치면 reload) */
let cache: OutsourcePartner[] | null = null;

/** 외주 업체 목록 */
export function usePartners() {
  const [partners, setPartners] = useState<OutsourcePartner[]>(cache ?? []);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/outsource-partners', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? '외주 업체를 받지 못했습니다.'); return; }
      cache = json.partners as OutsourcePartner[];
      setPartners(cache);
      setError('');
    } catch { setError('외주 업체를 받지 못했습니다.'); }
  }, []);
  useEffect(() => { if (!cache) void reload(); }, [reload]);
  return { partners, error, reload };
}
