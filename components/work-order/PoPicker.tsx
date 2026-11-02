'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import NativeSelect from '@/components/ui/native-select';
import { siteScore } from '@/lib/purchase-order/manual';

interface PoOption {
  id: string; intake_number: string; site_name: string | null; customer_name: string | null;
  creator_name: string; created_at: string;
}

/**
 * "어느 발주서에서 나온 건가요? (선택)" — 작업의뢰서를 등록하면서 발주서를 고른다 (2026-11-02).
 * 고르면 저장할 때 그 발주서에 붙는다: 발주서에 진행률이 보이고, 생산 화면에 발주서 올린 사람이 뜬다.
 * 현장명 · 거래처가 닮은 발주서를 위로 올리고, 닮은 게 있으면 한 번에 고르게 권한다(저절로 고르지는 않는다).
 */
export default function PoPicker({ value, onChange, siteHint, customerHint }: {
  value: string;
  onChange: (id: string) => void;
  siteHint?: string;
  customerHint?: string;
}) {
  const [options, setOptions] = useState<PoOption[] | null>(null);
  useEffect(() => {
    fetch('/api/purchase-orders/options').then(r => (r.ok ? r.json() : null))
      .then(j => setOptions(j?.options ?? [])).catch(() => setOptions([]));
  }, []);

  const ranked = useMemo(() => (options ?? [])
    .map(o => ({ o, score: Math.max(siteScore(siteHint, o.site_name), 0.6 * siteScore(customerHint, o.customer_name)) }))
    .sort((a, b) => b.score - a.score || b.o.created_at.localeCompare(a.o.created_at)), [options, siteHint, customerHint]);
  const best = ranked[0] && ranked[0].score >= 0.5 ? ranked[0].o : null;

  return (
    <div className="space-y-1.5">
      <NativeSelect className="w-full sm:max-w-xl" value={value} onChange={e => onChange(e.target.value)} aria-label="발주서">
        <option value="">{options ? '고르지 않음 (발주서 없이 등록)' : '발주서 불러오는 중…'}</option>
        {ranked.map(({ o, score }) => (
          <option key={o.id} value={o.id}>
            {score >= 0.5 ? '★ ' : ''}{o.intake_number} · {o.site_name || o.customer_name || '현장명 없음'} · {o.creator_name}
          </option>
        ))}
      </NativeSelect>
      {!value && best && (
        <button type="button" onClick={() => onChange(best.id)}
          className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-sm font-medium text-brand-800 hover:bg-brand-100">
          <Sparkles className="h-3.5 w-3.5" />현장이 비슷한 발주서: {best.intake_number} · {best.site_name || best.customer_name} — 고르기
        </button>
      )}
      <p className="text-xs text-muted-foreground">
        공사 담당자가 시스템에 올린 발주서에서 나온 작업의뢰서면 골라 주세요. 그 발주서에 진행률이 보이고, 생산 화면에 발주서 올린 사람이 뜹니다.
      </p>
    </div>
  );
}
