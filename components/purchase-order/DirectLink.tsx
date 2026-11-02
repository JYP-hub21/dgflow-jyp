'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Link2, Loader2, ScanLine, Search } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Candidate {
  id: string; work_order_number: string; customer: string | null; site: string | null;
  created_at: string; total: number; site_score: number; customer_score: number;
}

/**
 * 작업의뢰서 바로 잇기 — 우리 ERP 변환기를 안 써도 (2026-11-02 "변환기는 부가 기능, 써도 그만 안 써도 그만").
 * 담당 부서가 손으로 규격정리해 ERP 에 넣었어도, 나온 작업의뢰서를 여기서 골라 이 발주 건에 잇는다.
 * 이으면 진행 단계 · 생산 진행률 · 공사 담당자가 변환기를 쓴 때와 똑같이 따라온다.
 */
export default function DirectLink({ poId }: { poId: string }) {
  const router = useRouter();
  const [list, setList] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders/${poId}/direct-link`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? '작업의뢰서를 불러오지 못했습니다.'); return; }
      setList(json.candidates);
    } finally {
      setLoading(false);
    }
  }
  async function link(c: Candidate) {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/purchase-orders/${poId}/direct-link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ work_order_id: c.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? '연결하지 못했습니다.'); return; }
      toast.success(`작업의뢰서 ${c.work_order_number} 를 이 발주서에 이었습니다.`);
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4" />작업의뢰서 바로 잇기</CardTitle>
        <p className="text-sm text-muted-foreground">
          ERP 업로드 엑셀을 우리 변환기로 만들지 않고 손으로 정리했어도 괜찮습니다. ERP 에서 나온 작업의뢰서를 등록한 뒤 여기서 고르면
          이 발주서에 이어지고, 진행 단계와 생산 진행률이 따라옵니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Search />}등록된 작업의뢰서에서 고르기
          </Button>
          <Link href={`/work-orders/receive?po=${poId}`} className={buttonVariants({ variant: 'outline' })}>
            <ScanLine />새로 등록하면서 잇기
          </Link>
        </div>
        {list && (
          <div className="space-y-2">
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="의뢰번호 · 거래처 · 현장으로 찾기" className="max-w-sm" />
            {shown.length === 0 && <p className="text-sm text-muted-foreground">이을 수 있는 작업의뢰서가 없습니다. 이미 다른 발주서에 이어진 것은 빠집니다.</p>}
            <ul className="divide-y rounded-lg border">
              {shown.map(c => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-brand-800">
                      {c.work_order_number}
                      {c.site_score >= 0.5 && <span className="ml-2 rounded-md bg-success-50 px-1.5 py-0.5 text-[11px] font-semibold text-success">현장명 비슷함</span>}
                      {c.customer_score >= 0.8 && <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">거래처 같음</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{[c.customer, c.site].filter(Boolean).join(' · ') || '-'} · {c.total}장</p>
                  </div>
                  <Button size="sm" onClick={() => link(c)} disabled={busyId !== null}>
                    {busyId === c.id ? <Loader2 className="animate-spin" /> : <Link2 />}잇기
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
