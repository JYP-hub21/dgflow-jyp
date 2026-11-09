'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Candidate {
  id: string; work_order_number: string; customer: string | null; site: string | null;
  created_at: string; total: number; site_score: number; customer_score: number;
}

/**
 * 이미 등록한 작업의뢰서를 이 발주서에 붙이기 — "이 발주서의 작업의뢰서" 칸 안의 작은 링크.
 * 보통은 작업의뢰서를 등록할 때 발주서를 고르므로 이건 깜빡했을 때 쓰는 보조 길이다 (2026-11-02:
 * 따로 '바로 잇기' 칸을 두었더니 헷갈린다는 사용자 의견).
 * 서버가 우리 변환기로 만든 포장 중 규격이 맞는 곳이 있으면 거기에, 없으면 그냥 이 발주서에 붙인다.
 */
export default function PickExistingWorkOrder({ poId }: { poId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Candidate[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState('');

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !list) {
      const res = await fetch(`/api/purchase-orders/${poId}/direct-link`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? '작업의뢰서를 불러오지 못했습니다.'); return; }
      setList(json.candidates);
    }
  }
  async function attach(c: Candidate) {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/purchase-orders/${poId}/direct-link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ work_order_id: c.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? '연결하지 못했습니다.'); return; }
      toast.success(json.mode === 'package'
        ? `작업의뢰서 ${c.work_order_number} 연결 완료 (${json.label}) — ${json.summary}`
        : `작업의뢰서 ${c.work_order_number} 연결 완료`);
      setList(prev => prev?.filter(x => x.id !== c.id) ?? null);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!list) return [];
    return k ? list.filter(c => [c.work_order_number, c.customer, c.site].some(v => v?.toLowerCase().includes(k))) : list;
  }, [list, q]);

  return (
    <div className="space-y-2">
      <button type="button" onClick={toggle} className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        등록된 작업의뢰서에서 선택{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          {!list ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중…</p> : <>
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="의뢰번호 · 거래처 · 현장으로 찾기" className="max-w-sm bg-card" />
            {shown.length === 0 && <p className="text-sm text-muted-foreground">선택 가능한 작업의뢰서가 없습니다. 다른 발주서에 연결된 작업의뢰서는 제외됩니다.</p>}
            <ul className="divide-y rounded-lg border bg-card">
              {shown.map(c => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-brand-800">
                      {c.work_order_number}
                      {c.site_score >= 0.5 && <span className="ml-2 rounded-md bg-success-50 px-1.5 py-0.5 text-[11px] font-semibold text-success">현장명 유사</span>}
                      {c.customer_score >= 0.8 && <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">거래처 일치</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{[c.customer, c.site].filter(Boolean).join(' · ') || '-'} · {c.total}조</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => attach(c)} disabled={busyId !== null}>
                    {busyId === c.id ? <Loader2 className="animate-spin" /> : <Plus />}이 발주서에 연결
                  </Button>
                </li>
              ))}
            </ul>
          </>}
        </div>
      )}
    </div>
  );
}
