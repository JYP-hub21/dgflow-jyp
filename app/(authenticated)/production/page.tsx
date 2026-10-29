import { createServerSupabaseClient } from '@/lib/supabase/server';
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
import { Factory, ScanLine, ClipboardList } from 'lucide-react';

const PAGE_SIZE = 20;

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ page?: string; view?: string }> }) {
  const params = await searchParams;
  const view = params.view === 'remaining' ? 'remaining' : 'orders';
  const page = parseInt(params.page || '1');
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createServerSupabaseClient();

  // 남은 품목 — 진행 중 의뢰서의 품목 중 잔여가 있는 것. 열끼리 비교는 쿼리로 못 해 여기서 거른다
  const { data: openOrders } = await supabase
    .from('dgflow_work_orders')
    .select(`
      id, work_order_number, delivery_date, created_at, customer_label, site_label,
      order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name)),
      items:dgflow_work_order_items(id, product_name, width_mm, height_mm, quantity, produced_quantity, sort_order)
    `)
    .in('status', ['pending', 'in_progress']);
  const remainingGroups: RemainingGroup[] = (openOrders || [])
    .map(wo => {
      const labels = workOrderLabels(wo as unknown as WorkOrderLabelSource);
      const items = ((wo.items || []) as (RemainingItem & { sort_order: number })[])
        .filter(i => i.quantity - i.produced_quantity > 0)
        .sort((a, b) => a.sort_order - b.sort_order);
      return {
        id: wo.id, work_order_number: wo.work_order_number, delivery_date: wo.delivery_date,
        customer: labels.customer ?? null, site: labels.site ?? null, items, created_at: wo.created_at as string,
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
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="생산 현황"
        description={view === 'remaining'
          ? '아직 다 만들지 않은 품목만 모았습니다. 납기가 가까운 작업의뢰서부터 보입니다.'
          : '진행 중인 작업의뢰서입니다. 생산 입력을 눌러 오늘 만든 수량을 적으세요.'}
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
      </nav>

      {view === 'remaining' ? <RemainingItems groups={remainingGroups} today={today} /> : <>
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
                <TableHead className="text-right">완료 / 의뢰</TableHead>
                <TableHead className="w-52">진행률</TableHead>
                <TableHead className="pr-5 text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!workOrders || workOrders.length === 0) ? (
                <TableRow><TableCell colSpan={6} className="p-6"><Empty /></TableCell></TableRow>
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
