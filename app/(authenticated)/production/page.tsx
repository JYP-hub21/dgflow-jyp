import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { contactsForWorkOrders, type SiteContact } from '@/lib/production/contacts';
import { SITE_SELECT, telHref, toWorkOrderSite } from '@/lib/work-order/site';
import SiteBadge from '@/components/work-order/SiteBadge';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import Progress from '@/components/ui/progress';
import PageHeader from '@/components/layout/PageHeader';
import Link from 'next/link';
import Pagination from '@/components/ui/pagination';
import { chipClass } from '@/components/ui/chip';
import RemainingItems, { type RemainingGroup, type RemainingItem } from '@/components/production/RemainingItems';
import { Factory, ScanLine, ClipboardList, Phone } from 'lucide-react';

const PAGE_SIZE = 20;

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ page?: string; view?: string }> }) {
  const params = await searchParams;
  const view = params.view === 'remaining' ? 'remaining' : params.view === 'outsource' ? 'outsource' : 'orders';
  const page = parseInt(params.page || '1');
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createServerSupabaseClient();

  // 남은 품목 — 진행 중 의뢰서의 품목 중 잔여가 있는 것. 열끼리 비교는 쿼리로 못 해 여기서 거른다
  const { data: openOrders } = await supabase
    .from('dgflow_work_orders')
    .select(`
      id, work_order_number, delivery_date, created_at, customer_label, site_label,
      order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name)),
      items:dgflow_work_order_items(id, product_name, width_mm, height_mm, quantity, produced_quantity, sort_order, item_no, remark)
    `)
    .in('status', ['pending', 'in_progress'])
    // 오창공장의 할 일만 — 외주로 준 의뢰서는 '외주' 에서 따로 본다 (2026-11-02)
    .eq('production_site', 'ochang');

  // 의뢰서마다 마지막으로 생산한 날 · 현장 담당자 (2026-10-30 피드백 — 오래 밀린 미작업 · 누구 건인지)
  const openIds = (openOrders || []).map(wo => wo.id as string);
  const lastProduced = new Map<string, string>();
  if (openIds.length > 0) {
    const { data: lastLogs } = await supabase
      .from('dgflow_production_logs').select('work_order_id, production_date')
      .in('work_order_id', openIds).order('production_date', { ascending: false }).limit(5000);
    for (const l of lastLogs || []) if (!lastProduced.has(l.work_order_id as string)) lastProduced.set(l.work_order_id as string, l.production_date as string);
  }
  const contacts = await contactsForWorkOrders(createServiceRoleClient(), openIds);

  const remainingGroups: RemainingGroup[] = (openOrders || [])
    .map(wo => {
      const labels = workOrderLabels(wo as unknown as WorkOrderLabelSource);
      const items = ((wo.items || []) as RemainingItem[])
        .filter(i => i.quantity - i.produced_quantity > 0)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const contact = contacts.get(wo.id as string);
      return {
        id: wo.id, work_order_number: wo.work_order_number, delivery_date: wo.delivery_date,
        customer: labels.customer ?? null, site: labels.site ?? null, items, created_at: wo.created_at as string,
        last_produced: lastProduced.get(wo.id as string) ?? null,
        contact: contact ?? null,
      };
    })
    .filter(g => g.items.length > 0)
    // 납기 가까운 것부터, 납기가 없으면 뒤로 (그 안에서는 먼저 등록한 것부터)
    .sort((a, b) => (a.delivery_date ?? '9999').localeCompare(b.delivery_date ?? '9999') || a.created_at.localeCompare(b.created_at));
  const remainingItemCount = remainingGroups.reduce((s, g) => s + g.items.length, 0);
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  const { data: workOrders, count } = await supabase
    .from('dgflow_work_orders')
    .select(`
      *,
      order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name)),
      items:dgflow_work_order_items(quantity, produced_quantity)
    `, { count: 'exact' })
    .in('status', ['pending', 'in_progress'])
    .eq('production_site', 'ochang')
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  // 외주로 준 진행 중 의뢰서 — 업체 · 담당자 · 발주서 올린 사람
  const { data: outsourced } = await supabase
    .from('dgflow_work_orders')
    .select(`
      id, work_order_number, delivery_date, customer_label, site_label, ${SITE_SELECT},
      order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name)),
      items:dgflow_work_order_items(quantity, produced_quantity)
    `)
    .in('status', ['pending', 'in_progress'])
    .eq('production_site', 'outsource')
    .order('delivery_date', { ascending: true, nullsFirst: false });
  const outsourceContacts = await contactsForWorkOrders(createServiceRoleClient(), (outsourced || []).map(w => w.id as string));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="생산 현황"
        description={view === 'remaining'
          ? '아직 다 만들지 않은 품목만 모았습니다. 납기가 가까운 작업의뢰서부터 보입니다.'
          : view === 'outsource'
            ? '외주로 준 작업의뢰서 — 어느 업체에서 만드는지, 누구에게 물어볼지 봅니다.'
            : '오창공장에서 만들 진행 중인 작업의뢰서입니다. 생산 입력을 눌러 오늘 만든 수량을 적으세요.'}
        actions={
          <Link href="/production/report" className={buttonVariants({ variant: 'outline' })}>
            <ClipboardList />일간 생산일지
          </Link>
        }
      />

      <nav className="flex gap-2">
        <Link href="/production" className={chipClass(view === 'orders')}>작업의뢰서별</Link>
        <Link href="/production?view=remaining" className={chipClass(view === 'remaining')}>
          남은 품목<span className="tabular opacity-80">{remainingItemCount}</span>
        </Link>
        <Link href="/production?view=outsource" className={chipClass(view === 'outsource')}>
          외주<span className="tabular opacity-80">{(outsourced || []).length}</span>
        </Link>
      </nav>

      {view === 'remaining' ? <RemainingItems groups={remainingGroups} today={today} />
      : view === 'outsource' ? <OutsourceList rows={(outsourced || []).map(wo => ({
          id: wo.id as string,
          number: wo.work_order_number as string,
          labels: workOrderLabels(wo as unknown as WorkOrderLabelSource),
          delivery: (wo.delivery_date as string | null) ?? null,
          site: toWorkOrderSite(wo),
          progress: progressOf(wo.items),
          contact: outsourceContacts.get(wo.id as string) ?? null,
        }))} />
      : <>
      {/* 폰 — 작업의뢰서당 카드 */}
      <div className="space-y-3 md:hidden">
        {(!workOrders || workOrders.length === 0) && <Empty />}
        {(workOrders || []).map(wo => {
          const labels = workOrderLabels(wo);
          const p = progressOf(wo.items);
          return (
            <Card key={wo.id} size="sm">
              <CardContent className="space-y-3">
                <Link href={`/work-orders/${wo.id}`} className="block">
                  <p className="font-bold">{wo.work_order_number}
                    <span className="ml-2 font-medium text-muted-foreground">{labels.customer ?? ''}</span></p>
                  <p className="truncate text-sm text-muted-foreground">{labels.site ?? '-'}</p>
                </Link>
                <ContactLine contact={contacts.get(wo.id) ?? null} />
                <div className="flex items-center gap-3">
                  <Progress value={p.percent} className="flex-1" />
                  <span className="tabular shrink-0 text-sm"><b>{p.done}</b>/{p.total}</span>
                </div>
                <Link href={`/production/${wo.id}`} className={buttonVariants({ size: 'lg', className: 'w-full' })}>
                  <Factory />생산 입력
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
                <TableHead>발주서 올린 사람</TableHead>
                <TableHead className="text-right">완료 / 의뢰</TableHead>
                <TableHead className="w-52">진행률</TableHead>
                <TableHead className="pr-5 text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!workOrders || workOrders.length === 0) ? (
                <TableRow><TableCell colSpan={7} className="p-6"><Empty /></TableCell></TableRow>
              ) : workOrders.map(wo => {
                // ERP 에서 등록한 작업의뢰서는 주문이 없어 자신의 라벨을 쓴다
                const labels = workOrderLabels(wo);
                const p = progressOf(wo.items);
                return (
                  <TableRow key={wo.id}>
                    <TableCell className="pl-5">
                      <Link href={`/work-orders/${wo.id}`} className="font-bold text-brand-800 hover:underline">
                        {wo.work_order_number}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">{labels.customer ?? '-'}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">{labels.site ?? '-'}</TableCell>
                    <TableCell><ContactLine contact={contacts.get(wo.id) ?? null} /></TableCell>
                    <TableCell className="tabular text-right"><b>{p.done}</b><span className="text-muted-foreground"> / {p.total}</span></TableCell>
                    <TableCell><Progress value={p.percent} /></TableCell>
                    <TableCell className="pr-5 text-right">
                      <Link href={`/production/${wo.id}`} className={buttonVariants({ size: 'sm' })}>
                        <Factory />생산 입력
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Pagination totalCount={count || 0} pageSize={PAGE_SIZE} />
      </>}
    </div>
  );
}

function progressOf(items: unknown) {
  const list = items as { quantity: number; produced_quantity: number }[];
  const total = list.reduce((s, i) => s + i.quantity, 0);
  const done = list.reduce((s, i) => s + i.produced_quantity, 0);
  return { total, done, percent: total > 0 ? Math.round(done / total * 100) : 0 };
}

/** 발주서 올린 사람 — 이름 · 전화(누르면 전화 걸기) */
function ContactLine({ contact }: { contact: SiteContact | null }) {
  if (!contact) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-sm">
      <span className="font-medium">{contact.name}</span>
      {contact.phone && (
        <a href={telHref(contact.phone)} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-800 hover:underline">
          <Phone className="h-3 w-3" />{contact.phone}
        </a>
      )}
    </span>
  );
}

interface OutsourceRow {
  id: string;
  number: string;
  labels: { customer?: string | null; site?: string | null };
  delivery: string | null;
  site: ReturnType<typeof toWorkOrderSite>;
  progress: { total: number; done: number; percent: number };
  contact: SiteContact | null;
}

/** 외주로 준 의뢰서 — 어느 업체 · 누구에게 물을지, 발주서를 올린 사람 */
function OutsourceList({ rows }: { rows: OutsourceRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card py-10 text-center text-sm text-muted-foreground">
        외주로 준 진행 중 작업의뢰서가 없습니다. 작업의뢰서 화면에서 생산 공장을 외주로 바꿀 수 있습니다.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">다른 공장에 외주로 준 작업의뢰서입니다. 오창공장의 생산 현황 · 남은 품목에는 나오지 않습니다.</p>
      {rows.map(r => (
        <Card key={r.id} size="sm">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-56">
              <Link href={`/work-orders/${r.id}`} className="font-bold text-brand-800 hover:underline">{r.number}</Link>
              <span className="ml-2 font-medium">{r.labels.customer ?? ''}</span>
              <p className="truncate text-sm text-muted-foreground">{r.labels.site ?? '-'}{r.delivery && ` · 납기 ${r.delivery}`}</p>
            </div>
            <div className="min-w-0 basis-64">
              <SiteBadge value={r.site} withContact />
            </div>
            <div className="min-w-0 basis-48">
              <p className="text-xs text-muted-foreground">발주서 올린 사람</p>
              <ContactLine contact={r.contact} />
            </div>
            <div className="flex w-40 items-center gap-2">
              <Progress value={r.progress.percent} className="flex-1" />
              <span className="tabular shrink-0 text-xs"><b>{r.progress.done}</b>/{r.progress.total}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card py-10 text-center">
      <p className="text-sm text-muted-foreground">진행 중인 생산이 없습니다.</p>
      <Link href="/work-orders/receive" className={buttonVariants({ variant: 'outline' })}>
        <ScanLine />작업의뢰서 등록하기
      </Link>
    </div>
  );
}
