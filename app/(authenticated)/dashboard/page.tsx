import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { USER_ROLES } from '@/types/user';
import { workOrderLabels } from '@/lib/work-order/labels';
import { hasAnyPermission, ORDER_ANY } from '@/lib/auth/role-guard';
import PipelinePanel from '@/components/purchase-order/PipelinePanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { format, addDays } from 'date-fns';
import {
  ArrowRight, Clock, Factory, FileCheck, FileSpreadsheet, Inbox, Layers, Ruler, ScanLine,
} from 'lucide-react';

interface ItemQty { quantity: number; produced_quantity: number }

function progressOf(items: ItemQty[]) {
  const total = items.reduce((s, i) => s + i.quantity, 0);
  const done = items.reduce((s, i) => s + i.produced_quantity, 0);
  return { total, done, percent: total > 0 ? Math.round(done / total * 100) : 0 };
}

/*
  실제 업무 흐름 — 발주서를 접수하고, ERP 업로드 엑셀을 만들고, ERP 가 뽑아 준
  작업의뢰서를 받아 생산을 기록한다. 대시보드도 주문이 아니라 이 흐름을 보여 준다.
*/
const FLOW = [
  { step: 1, label: '발주서 접수', hint: '올리고 담당자 지목 · 확인 여부', href: '/purchase-orders', icon: Inbox },
  { step: 2, label: 'ERP 업로드 엑셀 만들기', hint: '발주 건에서 바로 변환 · 저장', href: '/erp-upload', icon: FileSpreadsheet },
  { step: 3, label: '작업의뢰서 등록', hint: 'ERP 에서 받은 엑셀·PDF 업로드', href: '/work-orders/receive', icon: ScanLine },
  { step: 4, label: '생산 현황', hint: '생산 수량 입력 · 진행률 확인', href: '/production', icon: Factory },
];

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();

  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(new Date(), 'yyyy-MM-01');
  const weekLater = format(addDays(new Date(), 7), 'yyyy-MM-dd');

  const [{ data: activeOrders }, { data: todayLogs }, { data: monthLogs }] = await Promise.all([
    supabase.from('dgflow_work_orders')
      .select(`
        *,
        order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name)),
        items:dgflow_work_order_items(quantity, produced_quantity)
      `)
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: false }),
    supabase.from('dgflow_production_logs').select('quantity_completed').eq('production_date', today),
    supabase.from('dgflow_production_logs').select('area_m2').gte('production_date', monthStart),
  ]);

  const active = (activeOrders || []).map(wo => ({
    ...wo,
    labels: workOrderLabels(wo),
    progress: progressOf(wo.items as ItemQty[]),
  }));

  const remaining = active.reduce((s, wo) => s + (wo.progress.total - wo.progress.done), 0);
  const todayQty = (todayLogs || []).reduce((s, l) => s + l.quantity_completed, 0);
  const monthArea = (monthLogs || []).reduce((s, l) => s + Number(l.area_m2 || 0), 0);

  const urgent = active
    .filter(wo => wo.delivery_date && wo.delivery_date <= weekLater)
    .sort((a, b) => a.delivery_date!.localeCompare(b.delivery_date!));

  const stats = [
    { label: '진행 중 작업의뢰서', value: active.length, unit: '건', icon: FileCheck },
    { label: '남은 생산 수량', value: remaining, unit: '장', icon: Layers },
    { label: '오늘 생산', value: todayQty, unit: '장', icon: Clock },
    { label: '이번 달 생산 면적', value: monthArea.toFixed(1), unit: 'm²', icon: Ruler },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground">대시보드</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{user?.name}</span>
            <span className="mx-1.5 text-border">·</span>
            {user ? USER_ROLES[user.role] : ''}
          </p>
        </div>
        <p className="tabular text-xs text-muted-foreground">
          {format(new Date(), 'yyyy년 M월 d일')} 기준
        </p>
      </div>

      {/* 업무 흐름 — 바로 가기 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {FLOW.map((f) => {
          const Icon = f.icon;
          return (
            <Link
              key={f.href}
              href={f.href}
              className="group flex items-center gap-4 rounded-xl border border-border/70 bg-card px-4 py-4 shadow-sm transition-all hover:border-brand-600/40 hover:shadow-md"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-800">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-muted-foreground">STEP {f.step}</p>
                <p className="truncate text-sm font-semibold text-foreground">{f.label}</p>
                <p className="truncate text-xs text-muted-foreground">{f.hint}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          );
        })}
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        2 와 3 사이에서 만든 엑셀을 회사 ERP 에 올리고, ERP 가 뽑아 준 작업의뢰서를 받아 옵니다. 받아 온 의뢰서는 발주 건의 포장과 자동으로 대조됩니다.
      </p>

      {user && hasAnyPermission(user, ORDER_ANY) && <PipelinePanel meId={user.id} />}

      {/* 요약 카드 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card
              key={s.label}
              className="relative overflow-hidden border-border/70 shadow-sm"
            >
              <span className="absolute inset-x-0 top-0 h-[3px] bg-brand-gradient" />
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <p className="text-[12px] font-semibold tracking-wide text-muted-foreground">
                    {s.label}
                  </p>
                  <Icon className="h-4 w-4 shrink-0 text-brand-600/70" />
                </div>
                <p className="tabular mt-3 text-[32px] font-bold leading-none tracking-tight text-foreground">
                  {s.value}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{s.unit}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 납기 임박 */}
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px] font-semibold">
              납기 임박 <span className="font-normal text-muted-foreground">7일 이내 · 미완료</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {urgent.length === 0 ? (
              <EmptyRow text="임박한 납기가 없습니다." />
            ) : (
              <div className="-mx-2 space-y-0.5">
                {urgent.map(wo => (
                  <WorkOrderRow key={wo.id} wo={wo}>
                    <span className="tabular shrink-0 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1 text-[11px] font-semibold text-destructive">
                      {wo.delivery_date}
                    </span>
                  </WorkOrderRow>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 진행 중 */}
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-[15px] font-semibold">진행 중 작업의뢰서</CardTitle>
            <Link href="/production" className="text-xs font-medium text-muted-foreground hover:text-foreground">
              전체 보기
            </Link>
          </CardHeader>
          <CardContent>
            {active.length === 0 ? (
              <EmptyRow text="진행 중인 작업의뢰서가 없습니다." />
            ) : (
              <div className="-mx-2 space-y-0.5">
                {active.slice(0, 8).map(wo => (
                  <WorkOrderRow key={wo.id} wo={wo}>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="h-2 w-20 overflow-hidden rounded-full bg-border/60">
                        <div className="h-full rounded-full bg-brand-600" style={{ width: `${wo.progress.percent}%` }} />
                      </div>
                      <span className="tabular w-9 text-right text-xs text-muted-foreground">{wo.progress.percent}%</span>
                    </div>
                  </WorkOrderRow>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function WorkOrderRow({ wo, children }: {
  wo: { id: string; work_order_number: string; labels: { customer: string | null; site: string | null } };
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/work-orders/${wo.id}`}
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">
          {wo.work_order_number}
          <span className="ml-2 font-normal text-muted-foreground">{wo.labels.customer ?? ''}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">{wo.labels.site ?? '-'}</p>
      </div>
      {children}
    </Link>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed border-border py-8">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
