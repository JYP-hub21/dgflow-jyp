'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProductionSite, WorkOrderSite } from '@/lib/work-order/site';
import SiteBadge from './SiteBadge';
import ProductionSitePicker, { type SiteValue } from './ProductionSitePicker';

/** 작업의뢰서 화면의 생산 공장 — 보고, 권한이 있으면 바꾼다 (오창공장 ↔ 외주 업체) */
export default function SiteEditor({ workOrderId, value, partnerId, canEdit }: {
  workOrderId: string; value: WorkOrderSite; partnerId: string | null; canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SiteValue>({ site: value.site as ProductionSite, partnerId: partnerId ?? '' });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (draft.site === 'outsource' && !draft.partnerId) { toast.error('외주 업체를 고르세요.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/site`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ production_site: draft.site, outsource_partner_id: draft.partnerId || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? '바꾸지 못했습니다.'); return; }
      toast.success(draft.site === 'ochang' ? '오창공장에서 생산합니다.' : '외주로 바꿨습니다.');
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <SiteBadge value={value} withContact />
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-7 px-2 text-xs text-muted-foreground">
            <ArrowLeftRight />바꾸기
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ProductionSitePicker value={draft} onChange={setDraft} />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>저장</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>취소</Button>
      </div>
    </div>
  );
}
