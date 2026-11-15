import Link from 'next/link';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { fetchAllIn } from '@/lib/supabase/fetch-all';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import { SITE_SELECT, toWorkOrderSite } from '@/lib/work-order/site';
import { loadDeliveries, loadDeliveriesBetween } from '@/lib/production/delivery-store';
import {
  dailyDeliveryTotals, deliveredByItem, deliveriesByDateAndOrder, deliveryTodo, isMonth, monthRange, shiftMonth,
  type DeliveryTodo,
} from '@/lib/production/delivery';
import PageHeader from '@/components/layout/PageHeader';
import ListSearch, { searchCondition } from '@/components/work-order/ListSearch';
import WorkOrderStatusBadge from '@/components/work-order/WorkOrderStatusBadge';
import SiteBadge from '@/components/work-order/SiteBadge';
import DeliveryTrend from '@/components/production/DeliveryTrend';
import StockExcelButton, { type StockExcelRow } from '@/components/production/StockExcelButton';
import { itemStockLots, summarizeLots, STOCK_GRACE_DAYS, type StockLot, type StockSummary } from '@/lib/production/stock';
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
 * 위 요약 → 납품할 것(진행 중 의뢰서) · 납품 기록(달마다 날짜별 + 그래프) · 재고(생산 후 미납품, 2026-11-13 회의).
 */
export default async function DeliveriesPage({ searchParams }: {
  searchParams: Promise<{ view?: string; q?: string; month?: string; only?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === 'history' ? 'history' : params.view === 'stock' ? 'stock' : 'todo';
  const overdueOnly = params.view === 'stock' && params.only === 'overdue';
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
      items:dgflow_work_order_items(id, quantity, produced_quantity)
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
  // 품목별 납품 — 미납 · 바로 나갈 수량은 품목마다 따진다 (2026-11-10 점검: 한 품목을 더 내보내면 다른 품목 미납이 사라졌다)
  const deliveredItems = deliveredByItem(openLogs.logs);
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
      todo: deliveryTodo(wo.items as { id: string; quantity: number; produced_quantity: number }[], deliveredItems),
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
  // 의뢰서 이름 읽기 — 묶음으로 나눠 읽고, 실패하면 알린다. 예전에는 오류를 버려 모든 줄이 '삭제된 의뢰서' 로 보였다 (2026-11-10 점검)
  let historyError: string | null = null;
  if (view === 'history' && historyIds.length > 0) {
    try {
      const data = await fetchAllIn<Record<string, unknown>>(historyIds, (chunk, from, to) => supabase
        .from('dgflow_work_orders')
        .select(`id, work_order_number, customer_label, site_label,
          order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name))`)
        .in('id', chunk)
        .order('id')
        .range(from, to));
      for (const wo of data) {
        const labels = workOrderLabels(wo as unknown as WorkOrderLabelSource);
        historyOrders.set(wo.id as string, { number: wo.work_order_number as string, customer: labels.customer ?? null, site: labels.site ?? null });
      }
    } catch (e) {
      historyError = e instanceof Error ? e.message : String(e);
    }
  }
  // 재고 — 생산 후 아직 안 나간 것을 생산일별로 (먼저 만든 것부터 나갔다고 본다, lib/production/stock.ts)
  let stockRows: StockRow[] = [];
  let stockError: string | null = null;
  if (view === 'stock') {
    const readyIds = todos.filter(r => r.todo.ready > 0).map(r => r.id);
    const logsByItem = new Map<string, { date: string; qty: number }[]>();
    try {
      const logs = await fetchAllIn<{ work_order_item_id: string | null; production_date: string; quantity_completed: number }>(
        readyIds, (chunk, from, to) => service
          .from('dgflow_production_logs').select('work_order_item_id, production_date, quantity_completed')
          .in('work_order_id', chunk).order('id').range(from, to));
      for (const l of logs) {
        if (!l.work_order_item_id) continue;
        const list = logsByItem.get(l.work_order_item_id) ?? [];
        list.push({ date: l.production_date, qty: l.quantity_completed });
        logsByItem.set(l.work_order_item_id, list);
      }
    } catch (e) {
      stockError = e instanceof Error ? e.message : String(e);
    }
    const byId = new Map((openOrders || []).map(wo => [wo.id as string, wo]));
    stockRows = todos.filter(r => r.todo.ready > 0).map(r => {
      const items = (byId.get(r.id)?.items ?? []) as { id: string; quantity: number; produced_quantity: number }[];
      const lots: StockLot[] = items.flatMap(it => itemStockLots(it, logsByItem.get(it.id) ?? [], deliveredItems.get(it.id) ?? 0));
      return { id: r.id, number: r.number, labels: r.labels, due: r.due, stock: summarizeLots(lots, today) };
    }).filter(r => r.stock.qty > 0)
      // 현장별로 모으고, 그 안에서는 오래된 것부터
      .sort((a, b) => (a.labels.customer ?? '').localeCompare(b.labels.customer ?? '', 'ko')
        || (a.labels.site ?? '').localeCompare(b.labels.site ?? '', 'ko')
        || (a.stock.oldest ?? '9999').localeCompare(b.stock.oldest ?? '9999'));
  }
  const stockShown = overdueOnly ? stockRows.filter(r => r.stock.overdue > 0) : stockRows;

  const monthTotal = monthLogs.logs.reduce((s, l) => s + l.quantity, 0);
  const monthTotalArea = monthLogs.logs.reduce((s, l) => s + Number(l.area_m2 || 0), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="납품"
        description={view === 'history'
          ? '날짜별로 현장에 납품한 수량입니다. 의뢰번호를 누르면 해당 의뢰서의 납품을 입력하거나 수정할 수 있습니다.'
          : view === 'stock'
            ? `생산은 끝났지만 아직 납품되지 않은 재고입니다. 먼저 생산한 것부터 납품된 것으로 보고, 생산 후 ${STOCK_GRACE_DAYS}일이 지난 수량을 따로 표시합니다.`
            : '납품이 완료되지 않은 작업의뢰서입니다. 납품일은 현장에 들어가는 날짜 기준으로 입력하세요.'}
      />

      {storage === 'none' && (
        <p className="break-keep rounded-lg border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm">
          납품 기록을 저장할 표가 아직 데이터베이스에 없습니다. 표를 만들면 납품을 입력할 수 있습니다.
        </p>
      )}

      {/* 요약 — 재고 보기는 자기 요약이 따로 있어 겹치지 않게 뺀다 */}
      {view !== 'stock' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard label="납품 대상 작업의뢰서" value={`${todos.length}건`} />
          <SummaryCard label="즉시 납품 가능 수량" value={`${readyQty.toLocaleString()}조`}
            sub={readyOrders > 0 ? `생산 완료 · 미납품 ${readyOrders}건` : '생산 완료 · 미납품 없음'} tone="brand" />
          <SummaryCard label="오늘 납품" value={`${todayQty.toLocaleString()}조`} sub={today} />
          <SummaryCard label="이번 달 납품" value={`${monthQty.toLocaleString()}조`} sub={`${monthArea.toFixed(2)}M²`} />
        </div>
      )}

      <nav className="flex flex-wrap gap-2">
        <Link href="/deliveries" className={chipClass(view === 'todo', 'whitespace-nowrap')}>
          납품 대기<span className="tabular opacity-80">{todos.length}</span>
        </Link>
        <Link href="/deliveries?view=stock" className={chipClass(view === 'stock', 'whitespace-nowrap')}>
          미납품 재고<span className="tabular opacity-80">{readyQty.toLocaleString()}조</span>
        </Link>
        <Link href={`/deliveries?view=history${month !== thisMonth ? `&month=${month}` : ''}`} className={chipClass(view === 'history', 'whitespace-nowrap')}>
          납품 기록
        </Link>
      </nav>

      {view === 'todo' ? (
        <>
          <ListSearch action="/deliveries" value={q} />
          <TodoList rows={todos} today={today} />
        </>
      ) : view === 'stock' ? (
        <StockView rows={stockRows} shown={stockShown} overdueOnly={overdueOnly} today={today} error={stockError} />
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
          {historyError && (
            <p className="break-keep rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive">
              작업의뢰서 정보를 불러오지 못해 의뢰번호 · 거래처가 비어 보입니다. 새로고침하세요. ({historyError})
            </p>
          )}
          <HistoryList days={days} orders={historyOrders} failed={!!historyError} />
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
        납품 대상 작업의뢰서가 없습니다.
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

interface StockRow {
  id: string;
  number: string;
  labels: { customer?: string | null; site?: string | null };
  due: string | null;
  stock: StockSummary;
}

const monthLabel = (m: string) => (m ? `${Number(m.slice(5))}월` : '생산일 모름');
const monthsText = (s: StockSummary) => s.byMonth.map(m => `${monthLabel(m.month)} ${m.qty.toLocaleString()}`).join(' · ');

/**
 * 재고 — 현장별로 묶고, 생산 후 2주가 지난 수량을 따로 표시한다 (2026-11-13 회의).
 * 대표님: 생산 후 2주까지는 기다려 주고, 지나면 가져가라고 하거나 보관료를 받는다.
 */
function StockView({ rows, shown, overdueOnly, today, error }: {
  rows: StockRow[]; shown: StockRow[]; overdueOnly: boolean; today: string; error: string | null;
}) {
  const total = rows.reduce((s, r) => s + r.stock.qty, 0);
  const overdue = rows.reduce((s, r) => s + r.stock.overdue, 0);
  const overdueOrders = rows.filter(r => r.stock.overdue > 0).length;
  const sites = new Map<string, StockRow[]>();
  for (const r of shown) {
    const key = `${r.labels.customer ?? '-'}\u0000${r.labels.site ?? '-'}`;
    sites.set(key, [...(sites.get(key) ?? []), r]);
  }
  const siteCount = new Set(rows.map(r => `${r.labels.customer ?? '-'}\u0000${r.labels.site ?? '-'}`)).size;
  const excelRows: StockExcelRow[] = shown.map(r => ({
    customer: r.labels.customer ?? '', site: r.labels.site ?? '', number: r.number, qty: r.stock.qty, overdue: r.stock.overdue,
    oldest: r.stock.oldest, newest: r.stock.newest, oldestDays: r.stock.oldestDays, months: monthsText(r.stock),
  }));

  return (
    <div className="space-y-4">
      {error && (
        <p className="break-keep rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive">
          생산 기록을 불러오지 못해 생산일이 비어 보일 수 있습니다. 새로고침하세요. ({error})
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="미납품 재고" value={`${total.toLocaleString()}조`} sub={`작업의뢰서 ${rows.length}건 · 현장 ${siteCount}곳`} tone="brand" />
        <SummaryCard label={`생산 후 ${STOCK_GRACE_DAYS}일 경과`} value={`${overdue.toLocaleString()}조`} sub={`작업의뢰서 ${overdueOrders}건 — 출고 요청 · 보관료 대상`} />
        <SummaryCard label="가장 오래된 재고" value={(() => {
          const d = rows.map(r => r.stock.oldestDays).filter((v): v is number => v !== null);
          return d.length ? `${Math.max(...d)}일째` : '-';
        })()} sub={`${today} 기준`} />
        <SummaryCard label="생산일 모름" value={`${rows.reduce((s, r) => s + r.stock.unknown, 0).toLocaleString()}조`} sub="생산 기록 없이 수량만 있는 품목" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Link href="/deliveries?view=stock" className={chipClass(!overdueOnly, 'whitespace-nowrap')}>
            전체<span className="tabular opacity-80">{rows.length}</span>
          </Link>
          <Link href="/deliveries?view=stock&only=overdue" className={chipClass(overdueOnly, 'whitespace-nowrap')}>
            {STOCK_GRACE_DAYS}일 지난 재고 있음<span className="tabular opacity-80">{overdueOrders}</span>
          </Link>
        </div>
        <StockExcelButton rows={excelRows} today={today} graceDays={STOCK_GRACE_DAYS} />
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-10 text-center text-sm text-muted-foreground">
          {overdueOnly ? `생산 후 ${STOCK_GRACE_DAYS}일이 지난 재고가 없습니다.` : '생산 후 납품되지 않은 재고가 없습니다.'}
        </div>
      ) : (
        <div className="space-y-3">
          {[...sites.values()].map(list => {
            const head = list[0].labels;
            const qty = list.reduce((s, r) => s + r.stock.qty, 0);
            const late = list.reduce((s, r) => s + r.stock.overdue, 0);
            return (
              <Card key={`${head.customer}-${head.site}`} className="gap-0 py-0">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-5 py-3">
                  <p className="min-w-0 font-bold">{head.customer ?? '-'}<span className="ml-2 font-medium text-muted-foreground">{head.site ?? ''}</span></p>
                  <p className="tabular text-sm">
                    재고 <b className="text-brand-800">{qty.toLocaleString()}조</b>
                    {late > 0 && <span className="ml-2 font-semibold text-destructive">{STOCK_GRACE_DAYS}일 경과 {late.toLocaleString()}조</span>}
                  </p>
                </div>
                <div className="divide-y">
                  {list.map(r => (
                    <div key={r.id} className="grid gap-x-4 gap-y-1 px-5 py-2.5 text-sm md:grid-cols-[110px_90px_1fr_auto] md:items-center">
                      <Link href={`/deliveries/${r.id}`} className="font-bold text-brand-800 hover:underline">{r.number}</Link>
                      <span className="tabular"><b>{r.stock.qty.toLocaleString()}조</b></span>
                      <span className="tabular min-w-0 text-muted-foreground">
                        생산 {r.stock.oldest ?? '모름'}{r.stock.newest && r.stock.newest !== r.stock.oldest ? ` – ${r.stock.newest}` : ''}
                        <span className="ml-2">{monthsText(r.stock)}</span>
                      </span>
                      <span className="tabular flex items-center gap-2 md:justify-end">
                        {r.stock.oldestDays !== null && (
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold',
                            r.stock.overdue > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
                            {r.stock.oldestDays}일째
                          </span>
                        )}
                        <Link href={`/deliveries/${r.id}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                          <Truck />납품 입력
                        </Link>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HistoryList({ days, orders, failed }: {
  days: ReturnType<typeof deliveriesByDateAndOrder>;
  orders: Map<string, { number: string; customer: string | null; site: string | null }>;
  /** 의뢰서 정보를 못 읽었다 — 못 찾은 줄을 '삭제된 의뢰서' 라고 하지 않는다 */
  failed: boolean;
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
                  <Link href={`/deliveries/${o.work_order_id}`} className="font-bold text-brand-800 hover:underline">{wo?.number ?? (failed ? '의뢰서 보기' : '삭제된 의뢰서')}</Link>
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
