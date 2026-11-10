import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { USER_ROLES } from '@/types/user';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import { hasAnyPermission, hasPermission, ORDER_ANY } from '@/lib/auth/role-guard';
import { listPurchaseOrders, type PoSummary } from '@/lib/purchase-order/server';
import { STAGE_LABEL, type PoStage } from '@/lib/purchase-order/stage';
import { DEPT_BY_KEY, type DeptKey } from '@/lib/departments';
import { DEPT_STYLE } from '@/components/layout/dept-style';
import { Card, CardContent } from '@/components/ui/card';
import { StageBadge } from '@/components/purchase-order/StageBadge';
import ProductionTrend, { TrendLegend, type TrendPoint } from '@/components/dashboard/ProductionTrend';
import { DEFAULT_LINES, lineName } from '@/lib/production/lines';
import { loadLines } from '@/lib/production/lines-store';
import { cn } from '@/lib/utils';
import { fetchAll, fetchAllIn } from '@/lib/supabase/fetch-all';
import { doneInMonth, NO_PROGRESS, progressByWorkOrder, type ItemQty } from '@/lib/dashboard/work-orders';
import type { SupabaseClient } from '@supabase/supabase-js';

/*
  대시보드 — 열면 한눈에 보이는 시각화 (2026-10-30 피드백 "조잡하다, 거의 시각화 자료처럼").
  숫자 네 칸 → 최근 2주 생산 · 발주서 단계 → 작업의뢰서 진행률 · 멈춘 발주서.
  누구나 본다(권한 없음). 눌러 들어가는 링크만 권한대로 열린다.
  메뉴 안내는 사이드바 부서 구역이 맡아서 여기에는 두지 않는다.
*/

interface OpenWorkOrderRow {
  id: string;
  work_order_number: string;
  delivery_date: string | null;
  customer_label: string | null;
  site_label: string | null;
  /** 주문에서 온 의뢰서의 거래처 · 현장 (workOrderLabels 가 읽는다) */
  order: unknown;
}

/**
 * 끝나지 않은(status 가 completed 가 아닌) 작업의뢰서와 품목별 진행 — 끝까지 나눠 읽는다.
 * status 는 전량 '납품' 해야 completed 라서, 생산이 남았는지는 품목 수량으로 따로 가른다 (2026-11-10 점검).
 */
async function loadOpenWorkOrders(supabase: SupabaseClient) {
  const wos = await fetchAll<OpenWorkOrderRow>((a, b) => supabase.from('dgflow_work_orders')
    .select(`
      id, work_order_number, delivery_date, customer_label, site_label,
      order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name))
    `)
    .in('status', ['pending', 'in_progress'])
    .order('created_at', { ascending: false })
    .order('id')
    .range(a, b));
  const items = await fetchAllIn<ItemQty>(wos.map(w => w.id), (chunk, a, b) => supabase
    .from('dgflow_work_order_items')
    .select('work_order_id, quantity, produced_quantity')
    .in('work_order_id', chunk)
    .order('id')
    .range(a, b));
  const progress = progressByWorkOrder(items);
  return wos.map(wo => ({ ...wo, labels: workOrderLabels(wo as WorkOrderLabelSource), progress: progress.get(wo.id) ?? NO_PROGRESS }));
}

/** 한국 시간 기준 'YYYY-MM-DD' (서버가 UTC 여도 날짜가 밀리지 않게) */
const kst = (offsetDays = 0) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
const dayDiff = (a: string, b: string) => Math.round((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000);

/** 발주서 단계 — 다음에 손댈 부서 (업무지원부 · 생산관리부). 완료는 회색 */
const STAGES: { stage: PoStage; turn: DeptKey | null }[] = [
  { stage: 'submitted', turn: 'support' },
  { stage: 'checked', turn: 'support' },
  { stage: 'erp_ready', turn: 'support' },
  { stage: 'linking', turn: 'support' },
  { stage: 'producing', turn: 'production' },
  { stage: 'done', turn: null },
];

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();

  const today = kst(0);
  const yesterday = kst(-1);
  const from = kst(-13);
  const monthStart = `${today.slice(0, 8)}01`;

  const [openOrders, { data: recentLogs }, { data: monthLogs }, posOrNull, { lines }] = await Promise.all([
    // 못 읽으면 빈 목록 대신 '읽지 못했다' 로 보인다
    loadOpenWorkOrders(supabase).catch((e: unknown) => { console.error('[dashboard] 작업의뢰서', e); return null; }),
    // 한 달 생산 기록이 1,000줄을 넘으면 잘려 이번 달 면적 · 막대가 적게 나왔다 — 끝까지 나눠 읽는다
    fetchAll((a, b) => supabase.from('dgflow_production_logs').select('production_date, quantity_completed, area_m2, line_number')
      .gte('production_date', from).lte('production_date', today).order('id').range(a, b)).then(data => ({ data }), () => ({ data: [] })),
    // work_order_id — 이번 달 생산이 있었던 의뢰서로 '이번 달 완료' 발주 건을 가른다
    fetchAll((a, b) => supabase.from('dgflow_production_logs').select('quantity_completed, area_m2, work_order_id')
      .gte('production_date', monthStart).order('id').range(a, b)).then(data => ({ data }), () => ({ data: [] })),
    // 발주 건은 권한이 있어야 읽히는 표라 서비스 키로 — 화면에는 건수와 이름만 보인다
    listPurchaseOrders(createServiceRoleClient()).catch((e: unknown) => { console.error('[dashboard] 발주서', e); return null; }),
    // 호기 이름 — 못 읽으면 1호기 · 2호기
    loadLines(supabase).catch(() => ({ lines: DEFAULT_LINES })),
  ]);

  const canOpenWorkOrders = user ? hasPermission(user, 'production:view') : false;
  const canOpenOrders = user ? hasAnyPermission(user, ORDER_ANY) : false;

  // ── 작업의뢰서 — 생산이 남은 것만 (다 만들고 납품만 남은 의뢰서는 따로 센다)
  const active = (openOrders ?? []).filter(wo => wo.progress.remaining > 0);
  const deliveryOnly = (openOrders ?? []).filter(wo => wo.progress.produced_all).length;
  const remaining = active.reduce((s, wo) => s + wo.progress.remaining, 0);
  const byDue = [...active].sort((a, b) =>
    (a.delivery_date ?? '9999').localeCompare(b.delivery_date ?? '9999') || b.progress.percent - a.progress.percent);

  // ── 생산 — 최근 14일, 호기별
  const trend: TrendPoint[] = Array.from({ length: 14 }, (_, i) => {
    const date = kst(-13 + i);
    return { date, label: `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`, weekday: weekdayOf(date), total: 0, area_m2: 0 };
  });
  const byDate = new Map(trend.map(t => [t.date, t]));
  const logged = new Set<number>();
  for (const l of recentLogs || []) {
    const t = byDate.get(l.production_date as string);
    if (!t) continue;
    const n: number = l.line_number ?? 1;
    logged.add(n);
    t[`line_${n}`] = (t[`line_${n}`] ?? 0) + l.quantity_completed;
    t.total += l.quantity_completed;
    t.area_m2 += Number(l.area_m2 || 0);
  }
  // 쌓을 호기 — 쓰는 호기(목록 순서) + 안 쓰게 됐어도 이 2주에 기록이 있는 호기
  const trendSeries = [
    ...[...lines].sort((a, b) => a.sort_order - b.sort_order || a.line_number - b.line_number)
      .filter(l => l.is_active || logged.has(l.line_number)).map(l => l.line_number),
    ...[...logged].filter(n => !lines.some(l => l.line_number === n)).sort((a, b) => a - b),
  ].map(line => ({ line, name: lineName(lines, line) }));
  const todayQty = byDate.get(today)?.total ?? 0;
  const yesterdayQty = byDate.get(yesterday)?.total ?? 0;
  const twoWeekQty = trend.reduce((s, t) => s + t.total, 0);
  const monthQty = (monthLogs || []).reduce((s, l) => s + l.quantity_completed, 0);
  const monthArea = (monthLogs || []).reduce((s, l) => s + Number(l.area_m2 || 0), 0);

  // ── 발주서
  const pos = posOrNull ?? [];
  const live = pos.filter(p => p.derived !== 'cancelled');
  // '이번 달 완료' — 접수일이 아니라 완료된 달로 센다(마지막 생산 기록 · 마지막 연결 중 늦은 쪽, doneInMonth)
  const producedThisMonth = new Set((monthLogs || []).map(l => l.work_order_id as string));
  const countOf = (s: PoStage) => s === 'done'
    ? live.filter(p => p.derived === 'done' && doneInMonth(p, monthStart, producedThisMonth)).length
    : live.filter(p => p.derived === s).length;
  const stageCounts = STAGES.map(s => ({ ...s, count: countOf(s.stage) }));
  const maxStage = Math.max(1, ...stageCounts.map(s => s.count));
  const waiting = stageCounts.filter(s => s.turn === 'support').reduce((n, s) => n + s.count, 0);
  const producing = stageCounts.find(s => s.stage === 'producing')?.count ?? 0;
  const stalled = live.filter(p => p.stalled_days != null).sort((a, b) => (b.stalled_days ?? 0) - (a.stalled_days ?? 0));
  const mineUnseen = user ? live.filter(p => p.assignee_id === user.id && p.derived === 'submitted').length : 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* 머리 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground">대시보드</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{user?.name}</span>
            {user?.department && <><span className="mx-1.5 text-border">·</span>{user.department}</>}
            <span className="mx-1.5 text-border">·</span>
            {user ? USER_ROLES[user.role] : ''}
          </p>
        </div>
        <p className="tabular text-xs text-muted-foreground">{today.replace(/-/g, '. ')}. ({weekdayOf(today)}) 기준</p>
      </div>

      {mineUnseen > 0 && (
        <Link href="/purchase-orders?view=todo"
          className="flex items-center justify-between rounded-xl border border-warning/40 bg-warning-50 px-4 py-3 text-sm font-semibold">
          수신 발주서 {mineUnseen}건을 아직 확인하지 않았습니다
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}

      {/* 숫자 네 칸 */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="오늘 생산" value={todayQty.toLocaleString()} unit="조" sub={`어제 ${yesterdayQty.toLocaleString()}조`} />
        <Kpi label="이번 달 생산 면적" value={monthArea.toLocaleString(undefined, { maximumFractionDigits: 1 })} unit="M²" sub={`이번 달 ${monthQty.toLocaleString()}조`} />
        <Kpi label="생산이 남은 작업의뢰서" value={openOrders ? String(active.length) : '-'} unit="건"
          sub={`남은 수량 ${remaining.toLocaleString()}조${deliveryOnly > 0 ? ` · 납품만 남은 ${deliveryOnly}건` : ''}`} />
        <Kpi label="처리 중 발주서" value={String(waiting)} unit="건" sub={`생산 중 ${producing}건`} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* 최근 2주 생산 */}
        <Panel className="xl:col-span-2" title="최근 2주 생산" sub={`${twoWeekQty.toLocaleString()}조`} right={<TrendLegend series={trendSeries} />}>
          {twoWeekQty === 0
            ? <Empty text="최근 2주 동안 입력된 생산 실적이 없습니다." />
            : <ProductionTrend data={trend} series={trendSeries} />}
        </Panel>

        {/* 발주서 단계 */}
        <Panel title="발주서 단계" sub={`진행 ${live.filter(p => p.derived !== 'done').length}건`}
          right={canOpenOrders ? <MoreLink href="/purchase-orders?view=open" /> : null}>
          {!posOrNull && <p className="mb-3 text-xs text-destructive">발주서를 읽지 못했습니다. 새로 고침하세요.</p>}
          <div className="space-y-2.5">
            {stageCounts.map(s => (
              <div key={s.stage} className="flex items-center gap-3">
                <span className="w-[7.5rem] shrink-0 whitespace-nowrap text-[13px] text-muted-foreground">{s.stage === 'done' ? '이번 달 완료' : STAGE_LABEL[s.stage]}</span>
                <div className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
                  <div className={cn('h-full rounded-md', s.turn ? DEPT_STYLE[s.turn].bar : 'bg-muted-foreground/35')}
                    style={{ width: s.count === 0 ? 0 : `${Math.max(6, (s.count / maxStage) * 100)}%` }} />
                </div>
                <span className="tabular w-8 shrink-0 text-right text-[15px] font-bold">{s.count}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(['support', 'production'] as const).map(k => (
              <span key={k} className="flex items-center gap-1.5">
                <span className={cn('h-2.5 w-2.5 rounded-sm', DEPT_STYLE[k].bar)} />{DEPT_BY_KEY[k].name} 차례
              </span>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* 작업의뢰서 진행률 — 납기 가까운 순 */}
        <Panel className="xl:col-span-2" title="작업의뢰서 진행률" sub="생산 잔여 · 납기 임박순"
          right={canOpenWorkOrders ? <MoreLink href="/production" /> : null}>
          {byDue.length === 0 ? <Empty text={openOrders ? '생산이 남은 작업의뢰서가 없습니다.' : '작업의뢰서를 읽지 못했습니다. 새로 고침하세요.'} /> : (
            <div className="-mx-2 space-y-0.5">
              {byDue.slice(0, 8).map(wo => (
                <Row key={wo.id} href={canOpenWorkOrders ? `/work-orders/${wo.id}` : null}>
                  <div className="min-w-0 sm:w-56 sm:shrink-0">
                    <p className="truncate text-sm font-bold text-foreground">{wo.work_order_number}</p>
                    <p className="truncate text-xs text-muted-foreground">{[wo.labels.customer, wo.labels.site].filter(Boolean).join(' · ') || '-'}</p>
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className={cn('h-full rounded-full', wo.progress.percent >= 100 ? 'bg-success' : 'bg-brand-600')}
                        style={{ width: `${Math.min(100, wo.progress.percent)}%` }} />
                    </div>
                    <span className="tabular w-24 shrink-0 text-right text-xs text-muted-foreground">
                      <b className="text-[13px] text-foreground">{wo.progress.percent}%</b> · {wo.progress.done}/{wo.progress.total}
                    </span>
                  </div>
                  <DueChip date={wo.delivery_date} today={today} />
                </Row>
              ))}
            </div>
          )}
        </Panel>

        {/* 멈춰 있는 발주서 */}
        <Panel title="지연 발주서" sub={stalled.length > 0 ? `${stalled.length}건` : undefined}>
          {stalled.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="text-sm text-muted-foreground">지연된 발주서가 없습니다.</p>
            </div>
          ) : (
            <div className="-mx-2 space-y-0.5">
              {stalled.slice(0, 6).map((p: PoSummary) => (
                <Row key={p.id} href={canOpenOrders ? `/purchase-orders/${p.id}` : null}>
                  <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <b>{p.site_name || p.intake_number}</b>
                    <span className="ml-2 text-muted-foreground">담당 {p.assignee_name ?? '-'}</span>
                  </span>
                  <StageBadge stage={p.derived} stalledDays={p.stalled_days} />
                </Row>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Kpi({ label, value, unit, sub }: { label: string; value: string; unit: string; sub: string }) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-5">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <p className="tabular mt-2 text-[30px] font-bold leading-none tracking-tight text-foreground">
          {value}<span className="ml-1 text-[15px] font-semibold text-muted-foreground">{unit}</span>
        </p>
        <p className="tabular mt-2 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function Panel({ title, sub, right, className, children }: {
  title: string; sub?: string; right?: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  return (
    <Card className={cn('gap-0 py-0', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-4">
        <h2 className="text-[15px] font-bold text-foreground">
          {title}{sub && <span className="tabular ml-2 text-[13px] font-medium text-muted-foreground">{sub}</span>}
        </h2>
        {right}
      </div>
      <CardContent className="px-5 pb-5">{children}</CardContent>
    </Card>
  );
}

function MoreLink({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground">
      전체 보기<ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

/** 목록 한 줄 — 권한이 없으면 링크 없이 보여 준다 */
function Row({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = 'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2.5 sm:flex-nowrap';
  return href
    ? <Link href={href} className={cn(cls, 'transition-colors hover:bg-muted/70')}>{children}</Link>
    : <div className={cls}>{children}</div>;
}

/** 납기까지 남은 날 — 지났거나 3일 안이면 눈에 띄게 */
function DueChip({ date, today }: { date: string | null; today: string }) {
  if (!date) return <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">납기 없음</span>;
  const d = dayDiff(date, today);
  const text = d < 0 ? `D+${-d}` : d === 0 ? 'D-day' : `D-${d}`;
  return (
    <span title={`납기 ${date}`} className={cn('tabular w-16 shrink-0 rounded-md px-2 py-1 text-center text-xs font-bold',
      d <= 0 ? 'bg-destructive/10 text-destructive' : d <= 3 ? 'bg-warning-50 text-warning' : 'bg-muted text-muted-foreground')}>
      {text}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl bg-muted/50 py-10">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
