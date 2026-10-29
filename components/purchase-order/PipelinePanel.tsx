import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { listPurchaseOrders } from '@/lib/purchase-order/server';
import { STAGE_LABEL, type PoStage } from '@/lib/purchase-order/stage';
import { StageBadge } from './StageBadge';

const COLUMNS: PoStage[] = ['submitted', 'checked', 'erp_ready', 'linking', 'producing', 'done'];

/**
 * 대시보드의 발주서 흐름 — 임원진이 "발주서 한 장이 지금 어디 있나" 를 한눈에 본다.
 * 단계별 건수와, 한 단계에 너무 오래 머문 건.
 */
export default async function PipelinePanel({ meId }: { meId: string }) {
  const all = await listPurchaseOrders(createServiceRoleClient());
  const live = all.filter(p => p.derived !== 'cancelled');
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const count = (s: PoStage) => s === 'done'
    ? live.filter(p => p.derived === 'done' && p.created_at >= monthStart).length
    : live.filter(p => p.derived === s).length;
  const stalled = live.filter(p => p.stalled_days != null).sort((a, b) => (b.stalled_days ?? 0) - (a.stalled_days ?? 0));
  const mineUnseen = live.filter(p => p.assignee_id === meId && p.derived === 'submitted').length;

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-[15px] font-semibold">
          발주서 흐름 <span className="font-normal text-muted-foreground">접수부터 생산 완료까지</span>
        </CardTitle>
        <Link href="/purchase-orders?view=open" className="text-xs font-medium text-muted-foreground hover:text-foreground">
          전체 보기
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {mineUnseen > 0 && (
          <Link href="/purchase-orders?view=todo"
            className="flex items-center justify-between rounded-lg border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm font-semibold">
            나에게 온 발주서 {mineUnseen}건을 아직 확인하지 않았습니다
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}

        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {COLUMNS.map((s, i) => (
            <div key={s} className="relative rounded-lg border bg-muted/30 px-3 py-3 text-center">
              <p className="text-[11px] font-semibold text-muted-foreground">{s === 'done' ? '이번 달 완료' : STAGE_LABEL[s]}</p>
              <p className="tabular mt-1 text-2xl font-bold">{count(s)}</p>
              {i < COLUMNS.length - 1 && (
                <ArrowRight className="absolute -right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-border md:block" />
              )}
            </div>
          ))}
        </div>

        {stalled.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" />멈춰 있는 건 {stalled.length}
            </p>
            <div className="-mx-2 space-y-0.5">
              {stalled.slice(0, 6).map(p => (
                <Link key={p.id} href={`/purchase-orders/${p.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted/60">
                  <span className="min-w-0 truncate">
                    <b>{p.site_name || p.intake_number}</b>
                    <span className="ml-2 text-muted-foreground">담당 {p.assignee_name ?? '-'}</span>
                  </span>
                  <StageBadge stage={p.derived} stalledDays={p.stalled_days} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
