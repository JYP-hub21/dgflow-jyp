import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { workOrderLabels } from '@/lib/work-order/labels';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Link from 'next/link';
import Pagination from '@/components/ui/pagination';
import { buttonVariants } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';
import PermissionGate from '@/components/layout/PermissionGate';
import WorkOrderStatusBadge from '@/components/work-order/WorkOrderStatusBadge';
import SiteBadge from '@/components/work-order/SiteBadge';
import ListSearch, { searchCondition } from '@/components/work-order/ListSearch';
import { toWorkOrderSite } from '@/lib/work-order/site';
import { loadReceipts } from '@/lib/work-order/receipts';
import { loadDeliveries } from '@/lib/production/delivery-store';
import { deliveredByWorkOrder } from '@/lib/production/delivery';
import { Badge } from '@/components/ui/badge';
import { ScanLine, FileText, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 20;

type Props = { searchParams: Promise<{ page?: string; q?: string }> };

// 등록 화면(/work-orders/receive)은 권한이 달라 폴더 layout 으로 막지 않고 여기서 막는다
export default function Page(props: Props) {
  return <PermissionGate permission="production:view"><WorkOrdersPage {...props} /></PermissionGate>;
}

async function WorkOrdersPage({ searchParams }: Props) {
  const params = await searchParams;
  const page = parseInt(params.page || '1');
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createServerSupabaseClient();

  const q = (params.q ?? '').trim();
  const search = searchCondition(q);
  let query = supabase
    .from('dgflow_work_orders')
    .select(`*, outsource_partner:dgflow_outsource_partners(name, contact_name, phone), order:dgflow_orders(order_number, customer:dgflow_customers(short_name), site:dgflow_sites(site_name)), items:dgflow_work_order_items(quantity, produced_quantity)`, { count: 'exact' });
  if (search) query = query.or(search);
  const { data: workOrders, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  // 납품 수량 · 수신 확인 — 표가 생기기 전에는 빈 값으로 온다
  const service = createServiceRoleClient();
  const ids = (workOrders || []).map(wo => wo.id as string);
  const [{ logs: deliveries }, { storage: receiptStorage, receipts }] = await Promise.all([
    loadDeliveries(service, ids), loadReceipts(service, ids),
  ]);
  const delivered = deliveredByWorkOrder(deliveries);
  const totalsOf = (wo: { id: string; items?: { quantity: number; produced_quantity: number }[] }) => ({
    quantity: (wo.items ?? []).reduce((s, i) => s + i.quantity, 0),
    produced: (wo.items ?? []).reduce((s, i) => s + i.produced_quantity, 0),
    delivered: delivered.get(wo.id) ?? 0,
  });
  const notReceived = (wo: { id: string; status: string; production_site?: string | null }) =>
    receiptStorage === 'db' && wo.status !== 'completed' && wo.production_site !== 'outsource' && !receipts.has(wo.id);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="작업의뢰서"
        description={`등록된 작업의뢰서 ${count ?? 0}건`}
        actions={
          <Link href="/work-orders/receive" className={buttonVariants()}>
            <ScanLine />작업의뢰서 등록
          </Link>
        }
      />

      <ListSearch action="/work-orders" value={q} />

      {/* 폰 — 카드 목록 */}
      <div className="space-y-2.5 md:hidden">
        {(!workOrders || workOrders.length === 0) && <Empty />}
        {(workOrders || []).map(wo => {
          const labels = workOrderLabels(wo);
          return (
            <Link key={wo.id} href={`/work-orders/${wo.id}`}
              className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 shadow-xs active:bg-brand-50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold">{wo.work_order_number}</span>
                  <WorkOrderStatusBadge status={wo.status} totals={totalsOf(wo)} />
                  {notReceived(wo) && <Badge variant="warning">수신 미확인</Badge>}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {[labels.customer, labels.site].filter(Boolean).join(' · ') || '-'}
                </p>
                <SiteBadge value={toWorkOrderSite(wo)} className="mt-1.5" />
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Link>
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
                <TableHead>의뢰일</TableHead>
                <TableHead>납품일</TableHead>
                <TableHead>생산 공장</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="pr-5"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!workOrders || workOrders.length === 0) ? (
                <TableRow><TableCell colSpan={8} className="p-6"><Empty /></TableCell></TableRow>
              ) : workOrders.map(wo => {
                // ERP 에서 등록한 작업의뢰서는 주문이 없어 자신의 라벨을 쓴다
                const labels = workOrderLabels(wo);
                return (
                  <TableRow key={wo.id}>
                    <TableCell className="pl-5">
                      <Link href={`/work-orders/${wo.id}`} className="font-bold text-brand-800 hover:underline">
                        {wo.work_order_number}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">{labels.customer ?? '-'}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">{labels.site ?? '-'}</TableCell>
                    <TableCell className="tabular">{wo.request_date}</TableCell>
                    <TableCell className="tabular">{wo.delivery_date || '-'}</TableCell>
                    <TableCell><SiteBadge value={toWorkOrderSite(wo)} /></TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1">
                        <WorkOrderStatusBadge status={wo.status} totals={totalsOf(wo)} />
                        {notReceived(wo) && <Badge variant="warning">수신 미확인</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="pr-5">
                      <div className="flex justify-end gap-2">
                        <Link href={`/work-orders/${wo.id}/preview`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                          <FileText />의뢰서
                        </Link>
                        <Link href={`/work-orders/${wo.id}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                          상세<ChevronRight />
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Pagination totalCount={count || 0} pageSize={PAGE_SIZE} />
    </div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card py-10 text-center">
      <p className="text-sm text-muted-foreground">작업의뢰서가 없습니다.</p>
      <Link href="/work-orders/receive" className={buttonVariants({ variant: 'outline' })}>
        <ScanLine />작업의뢰서 등록
      </Link>
    </div>
  );
}
