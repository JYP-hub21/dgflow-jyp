import Link from 'next/link';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import { SITE_SELECT, toWorkOrderSite } from '@/lib/work-order/site';
import { loadDeliveries, loadDeliveriesBetween } from '@/lib/production/delivery-store';
import {
  dailyDeliveryTotals, deliveredByWorkOrder, deliveriesByDateAndOrder, deliveryTodo, isMonth, monthRange, shiftMonth,
  type DeliveryTodo,
} from '@/lib/production/delivery';
import PageHeader from '@/components/layout/PageHeader';
import ListSearch, { searchCondition } from '@/components/work-order/ListSearch';
import WorkOrderStatusBadge from '@/components/work-order/WorkOrderStatusBadge';
import SiteBadge from '@/components/work-order/SiteBadge';
import DeliveryTrend from '@/components/production/DeliveryTrend';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import Progress from '@/components/ui/progress';
import { chipClass } from '@/components/ui/chip';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Truck } from 'lucide-react';

/**
 * 납품 — 생산관리부 메뉴 (2026-11-09 사용자 "이 탭에 차라리 납품탭을 하나 만드는거").
 * 예전에는 생산 입력 화면 안의 탭이라 어디서 넣는지 찾기 어려웠다.
 * 위 요약 → 납품할 것(진행 중 의뢰서) · 납품 기록(달마다 날짜별 + 그래프).
 */
export default async function DeliveriesPage({ searchParams }: {
  searchParams: Promise<{ view?: string; q?: string; month?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === 'history' ? 'history' : 'todo';
  const q = (params.q ?? '').trim();

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const month = isMonth(params.month) ? params.month : thisMonth;
  const range = monthRange(month);

  const supabase = await createServerSupabaseClient();
  const service = createServiceRoleClient();

  // 납품할 것 — 진행 중인 의뢰서 전부(오창 · 외주). 끝난 건(전량 납품)은 status 가 completed 라 빠진다
  let openQuery = supabase
    .from('dgflow_work_orders')
    .select(`
      id, work_order_number, status, delivery_date, created_at, customer_label, site_label, ${SITE_SELECT},
      order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name)),
      items:dgflow_work_order_items(quantity, produced_quantity)
    `)
    .in('status', ['pending', 'in_progress']);
  const search = searchCondition(q);
  if (search) openQuery = openQuery.or(search);
  const { data: openOrders } = await openQuery;
  const openIds = (openOrders || []).map(wo => wo.id as string);

  // 이번 달(고른 달) 기록 · 진행 중 의뢰서의 기록
  const [monthLogs, openLogs] = await Promise.all([
    loadDeliveriesBetween(service, range.from, range.to),
    loadDeliveries(service, openIds),
  ]);
  const storage = monthLogs.storage === 'none' || openLogs.storage === 'none' ? 'none' : 'db';
  const deliveredMap = deliveredByWorkOrder(openLogs.logs);
  const lastDelivered = new Map<string, string>();
  for (const l of openLogs.logs) {
    const prev = lastDelivered.get(l.work_order_id);
    if (!prev || l.delivery_date > prev) lastDelivered.set(l.work_order_id, l.delivery_date);
  }

  const todos = (openOrders || [])
    .map(wo => ({
      id: wo.id as string,
      number: wo.work_order_number as string,
      status: wo.status as string,
      due: (wo.delivery_date as string | null) ?? null,
      created: wo.created_at as string,
      labels: workOrderLabels(wo as unknown as WorkOrderLabelSource),
      site: toWorkOrderSite(wo),
      todo: deliveryTodo(wo.items as { quantity: number; produced_quantity: number }[], deliveredMap.get(wo.id as string) ?? 0),
      last: lastDelivered.get(wo.id as string) ?? null,
    }))
    .filter(r => r.todo.remaining > 0)
    // 지금 실을 수 있는 것(만들어 놓고 안 나간 것)이 있는 의뢰서가 위, 그 안에서는 납기가 가까운 것부터
    .sort((a, b) => Number(b.todo.ready > 0) - Number(a.todo.ready > 0)
      || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.created.localeCompare(b.created));

  // 요약
  const readyOrders = todos.filter(r => r.todo.ready > 0).length;
  const readyQty = todos.reduce((s, r) => s + r.todo.ready, 0);
  const thisMonthLogs = month === thisMonth ? monthLogs.logs : (await loadDeliveriesBetween(service, monthRange(thisMonth).from, today)).logs;
  const monthQty = thisMonthLogs.reduce((s, l) => s + l.quantity, 0);
  const monthArea = thisMonthLogs.reduce((s, l) => s + Number(l.area_m2 || 0), 0);
  const todayQty = thisMonthLogs.filter(l => l.delivery_date === today).reduce((s, l) => s + l.quantity, 0);

  // 납품 기록 — 날짜별 · 의뢰서별
  const days = deliveriesByDateAndOrder(monthLogs.logs);
  const daily = dailyDeliveryTotals(monthLogs.logs, range.from, month === thisMonth ? today : range.to);
  const historyIds = [...new Set(monthLogs.logs.map(l => l.work_order_id))];
  const historyOrders = new Map<string, { number: string; customer: string | null; site: string | null }>();
  if (view === 'history' && historyIds.length > 0) {
    const { data } = await supabase
      .from('dgflow_work_orders')
      .select(`id, work_order_number, customer_label, site_label,
        order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name))`)
      .in('id', historyIds);
    for (const wo of data || []) {
      const labels = workOrderLabels(wo as unknown as WorkOrderLabelSource);
      historyOrders.set(wo.id as string, { number: wo.work_order_number as string, customer: labels.customer ?? null, site: labels.site ?? null });
    }
  }
  const monthTotal = monthLogs.logs.reduce((s, l) => s + l.quantity, 0);
  const monthTotalArea = monthLogs.logs.reduce((s, l) => s + Number(l.area_m2 || 0), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="납품"
        description={view === 'history'
          ? '날짜별로 현장에 납품한 수량입니다. 의뢰번호를 누르면 그 의뢰서의 납품을 입력하거나 고칠 수 있습니다.'
          : '아직 다 나가지 않은 작업의뢰서입니다. 납품일은 현장에 들어가는 날짜 기준으로 입력하세요.'}
      />

      {storage === 'none' && (
        <p className="break-keep rounded-lg border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm">
          납품 기록을 저장할 표가 아직 데이터베이스에 없습니다. 표를 만들면 납품을 입력할 수 있습니다.
        </p>
      )}

      {/* 요약 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="납품할 작업의뢰서" value={`${todos.length}건`} />
        <SummaryCard label="바로 나갈 수 있는 수량" value={`${readyQty.toLocaleString()}조`}
          sub={readyOrders > 0 ? `생산 끝나고 아직 안 나간 것 · ${readyOrders}건` : '생산 끝나고 안 나간 것 없음'} tone="brand" />
        <SummaryCard label="오늘 납품" value={`${todayQty.toLocaleString()}조`} sub={today} />
        <SummaryCard label="이번 달 납품" value={`${monthQty.toLocaleString()}조`} sub={`${monthArea.toFixed(2)}M²`} />
      </div>

      <nav className="flex gap-2">
        <Link href="/deliveries" className={chipClass(view === 'todo')}>
          납품할 것<span className="tabular opacity-80">{todos.length}</span>
        </Link>
        <Link href={`/deliveries?view=history${month !== thisMonth ? `&month=${month}` : ''}`} className={chipClass(view === 'history')}>
          납품 기록
        </Link>
      </nav>

      {view === 'todo' ? (
        <>
          <ListSearch action="/deliveries" value={q} />
          <TodoList rows={todos} today={today} />
        </>
      ) : (
        <>
          <Card className="gap-3">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">{Number(month.slice(5))}월 날짜별 납품</CardTitle>
                <p className="tabular mt-0.5 text-sm text-muted-foreground">합계 <b className="text-foreground">{monthTotal.toLocaleString()}조</b> · {monthTotalArea.toFixed(2)}M²</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Link href={`/deliveries?view=history&month=${shiftMonth(month, -1)}`} aria-label="이전 달"
                  className={buttonVariants({ variant: 'outline', size: 'icon' })}><ChevronLeft /></Link>
                <span className="tabular w-20 text-center text-sm font-semibold">{month.replace('-', '.')}</span>
                {month < thisMonth ? (
                  <Link href={`/deliveries?view=history&month=${shiftMonth(month, 1)}`} aria-label="다음 달"
                    className={buttonVariants({ variant: 'outline', size: 'icon' })}><ChevronRight /></Link>
                ) : <span className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'pointer-events-none opacity-40')}><ChevronRight /></span>}
              </div>
            </CardHeader>
            <CardContent>
              <DeliveryTrend data={daily} />
            </CardContent>
          </Card>
          <HistoryList days={days} orders={historyOrders} />
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'brand' }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className={cn('tabular mt-1 text-2xl font-bold', tone === 'brand' && 'text-brand-800')}>{value}</p>
        {sub && <p className="tabular mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

interface TodoRow {
  id: string;
  number: string;
  status: string;
  due: string | null;
  labels: { customer?: string | null; site?: string | null };
  site: ReturnType<typeof toWorkOrderSite>;
  todo: DeliveryTodo;
  last: string | null;
}

function TodoList({ rows, today }: { rows: TodoRow[]; today: string }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card py-10 text-center text-sm text-muted-foreground">
        납품할 작업의뢰서가 없습니다.
      </div>
    );
  }
  return (
    <>
      {/* 폰 — 의뢰서당 카드 */}
      <div className="space-y-3 md:hidden">
        {rows.map(r => {
          const pct = r.todo.quantity > 0 ? Math.round(r.todo.delivered / r.todo.quantity * 100) : 0;
          return (
            <Card key={r.id} size="sm">
              <CardContent className="space-y-3">
                <Link href={`/work-orders/${r.id}`} className="block">
                  <p className="font-bold">{r.number}<span className="ml-2 font-medium text-muted-foreground">{r.labels.customer ?? ''}</span></p>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <WorkOrderStatusBadge status={r.status} totals={{ quantity: r.todo.quantity, produced: r.todo.produced, delivered: r.todo.delivered }} />
                    {r.site?.site === 'outsource' && <SiteBadge value={r.site} />}
                  </span>
                  <p className="truncate text-sm text-muted-foreground">{r.labels.site ?? '-'}</p>
                </Link>
                <p className="tabular text-sm">
                  의뢰 {r.todo.quantity} · 생산 {r.todo.produced} · 납품 <b className="text-brand-800">{r.todo.delivered}</b> · 미납 <b>{r.todo.remaining}</b>
                </p>
                <Progress value={pct} />
                <Link href={`/deliveries/${r.id}`} className={buttonVariants({ size: 'lg', className: 'w-full' })}>
                  <Truck />납품 입력
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* PC — 표 */}
      <Card className="hidden py-0 md:flex">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">의뢰번호</TableHead>
                <TableHead>거래처</TableHead>
                <TableHead>현장</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>납기</TableHead>
                <TableHead className="text-right">생산 / 의뢰</TableHead>
                <TableHead className="text-right">납품</TableHead>
                <TableHead className="text-right">미납</TableHead>
                <TableHead className="w-28">납품 진행</TableHead>
                <TableHead>최근 납품</TableHead>
                <TableHead className="pr-5 text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const pct = r.todo.quantity > 0 ? Math.round(r.todo.delivered / r.todo.quantity * 100) : 0;
                const late = r.due !== null && r.due < today;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="pl-5">
                      <Link href={`/work-orders/${r.id}`} className="font-bold text-brand-800 hover:underline">{r.number}</Link>
                    </TableCell>
                    <TableCell className="font-medium">{r.labels.customer ?? '-'}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-muted-foreground" title={r.labels.site ?? undefined}>{r.labels.site ?? '-'}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1">
                        <WorkOrderStatusBadge status={r.status} totals={{ quantity: r.todo.quantity, produced: r.todo.produced, delivered: r.todo.delivered }} />
                        {r.site?.site === 'outsource' && <SiteBadge value={r.site} />}
                      </span>
                    </TableCell>
                    <TableCell className={cn('tabular text-sm', late ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{r.due ?? '-'}</TableCell>
                    <TableCell className="tabular text-right">{r.todo.produced}<span className="text-muted-foreground"> / {r.todo.quantity}</span></TableCell>
                    <TableCell className="tabular text-right font-semibold text-brand-800">{r.todo.delivered}</TableCell>
                    <TableCell className="tabular text-right font-bold">{r.todo.remaining}</TableCell>
                    <TableCell><Progress value={pct} /></TableCell>
                    <TableCell className="tabular text-sm text-muted-foreground">{r.last ?? '-'}</TableCell>
                    <TableCell className="pr-5 text-right">
                      <Link href={`/deliveries/${r.id}`} className={buttonVariants({ size: 'sm' })}>
                        <Truck />납품 입력
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function HistoryList({ days, orders }: {
  days: ReturnType<typeof deliveriesByDateAndOrder>;
  orders: Map<string, { number: string; customer: string | null; site: string | null }>;
}) {
  if (days.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card py-10 text-center text-sm text-muted-foreground">
        이 달에는 납품 기록이 없습니다.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {days.map(day => (
        <Card key={day.date} className="gap-0 py-0">
          <div className="tabular flex items-center justify-between gap-3 border-b px-5 py-3">
            <p className="font-bold">{day.date} <span className="font-medium text-muted-foreground">({day.weekday})</span></p>
            <p className="text-sm"><b className="text-brand-800">{day.quantity.toLocaleString()}조</b><span className="ml-2 text-muted-foreground">{day.area_m2.toFixed(2)}M²</span></p>
          </div>
          <div className="divide-y">
            {day.orders.map(o => {
              const wo = orders.get(o.work_order_id);
              return (
                <div key={o.work_order_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                  <Link href={`/deliveries/${o.work_order_id}`} className="font-bold text-brand-800 hover:underline">{wo?.number ?? '삭제된 의뢰서'}</Link>
                  <span className="font-medium">{wo?.customer ?? ''}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{wo?.site ?? ''}{o.notes.length > 0 && ` · ${o.notes.join(' · ')}`}</span>
                  <span className="tabular shrink-0"><b>{o.quantity}조</b><span className="ml-2 text-muted-foreground">{o.area_m2.toFixed(2)}M²</span></span>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
