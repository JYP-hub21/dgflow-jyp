import { createServiceRoleClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';
import { blockTotals, itemNo, sizeText } from '@/lib/production/item-view';
import { contactsForWorkOrders } from '@/lib/production/contacts';
import { toWorkOrderSite } from '@/lib/work-order/site';
import { CONTACT_EDITORS, SITE_EDITORS } from '@/lib/work-order/site-server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission, hasPermission } from '@/lib/auth/role-guard';
import SiteEditor from '@/components/work-order/SiteEditor';
import ContactCard from '@/components/work-order/ContactCard';
import WorkOrderEditActions from '@/components/work-order/WorkOrderEditActions';
import ReceiptButton from '@/components/work-order/ReceiptButton';
import { formatKst, loadReceipts } from '@/lib/work-order/receipts';
import { loadDeliveries } from '@/lib/production/delivery-store';
import { groupDeliveries } from '@/lib/production/delivery';
import ProductionByDate from '@/components/production/ProductionByDate';
import RemarkText from '@/components/production/RemarkText';
import Link from 'next/link';
import { workOrderLabels } from '@/lib/work-order/labels';
import { fetchAll } from '@/lib/supabase/fetch-all';
import type { DateLog } from '@/lib/production/by-date';
import { cn } from '@/lib/utils';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Progress from '@/components/ui/progress';
import PageHeader from '@/components/layout/PageHeader';
import WorkOrderStatusBadge from '@/components/work-order/WorkOrderStatusBadge';
import { Factory, Scissors, FileText, CheckCircle, Truck } from 'lucide-react';

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceRoleClient();

  // 작업의뢰서 기본 정보
  const { data: workOrder } = await supabase
    .from('dgflow_work_orders')
    .select(`
      *,
      outsource_partner:dgflow_outsource_partners(name, contact_name, phone),
      order:dgflow_orders(
        order_number, order_date, delivery_date, remark,
        customer:dgflow_customers(name, short_name),
        site:dgflow_sites(site_name),
        creator:dgflow_users!created_by(name)
      )
    `)
    .eq('id', id)
    .single();

  if (!workOrder) notFound();

  // ERP 에서 받아 등록한 작업의뢰서는 주문이 없다 (마이그레이션 015). null 을 전제로 쓴다.
  const order = workOrder.order as {
    order_number: string; order_date: string; delivery_date: string; remark: string;
    customer: { name: string; short_name: string };
    site: { site_name: string };
    creator: { name: string };
  } | null;

  const labels = workOrderLabels(workOrder);

  // 품목 목록 + 생산 진행률
  const { data: items } = await supabase
    .from('dgflow_work_order_items')
    .select('*')
    .eq('work_order_id', id)
    .order('sort_order');

  const woItems = items || [];
  // 품명 덩어리 — 머리줄을 덩어리 첫 줄 앞에
  const itemBlocks = blockTotals(woItems);
  const blockStarts = new Map(itemBlocks.map((b, k) => [k === 0 ? 0 : itemBlocks[k - 1].endIndex + 1, b]));
  const blockEnds = new Map(itemBlocks.map(b => [b.endIndex, b]));
  const totalQty = woItems.reduce((s, i) => s + i.quantity, 0);
  const totalProduced = woItems.reduce((s, i) => s + i.produced_quantity, 0);
  const overallProgress = totalQty > 0 ? Math.round(totalProduced / totalQty * 100) : 0;

  // 복층 생산 기록 — 전부 (예전에는 최근 20건만 보여 한 달씩 만든 의뢰서는 앞이 잘렸다). 날짜별로 접어 보인다.
  // '전부' 라 해 놓고 range 가 없어 1,000줄에서 조용히 잘렸다 → 끝까지 나눠 읽는다. id 를 뒤에 걸어 쪽 경계에서 줄이 겹치거나 빠지지 않게 (2026-11-10 점검)
  const productionLogs = await fetchAll<DateLog>((from, to) => supabase
    .from('dgflow_production_logs')
    .select('work_order_item_id, production_date, quantity_completed, area_m2, shift, line_number')
    .eq('work_order_id', id)
    .order('production_date', { ascending: false })
    .order('id')
    .range(from, to)).catch(() => [] as DateLog[]);

  // 재단 이력 — 최근 20건만 보이고, 제목에는 전체 건수를 따로 센다 (예전에는 20건에서 멈춰 보였다, 2026-11-10 점검)
  const CUTTING_SHOWN = 20;
  const [{ data: cuttingLogs }, { count: cuttingTotal }] = await Promise.all([
    supabase
      .from('dgflow_cutting_logs')
      .select('*, created_by_user:dgflow_users!created_by(name)')
      .eq('work_order_id', id)
      .order('cutting_date', { ascending: false })
      .limit(CUTTING_SHOWN),
    supabase
      .from('dgflow_cutting_logs')
      .select('id', { count: 'exact', head: true })
      .eq('work_order_id', id),
  ]);
  const cuttingCount = cuttingTotal ?? (cuttingLogs ?? []).length;

  // 이 작업의뢰서가 나온 발주 건 (ERP 업로드 엑셀의 포장)
  const { data: source } = await supabase
    .from('dgflow_purchase_order_packages')
    .select('label, check_result, po:dgflow_purchase_orders(id, intake_number)')
    .eq('work_order_id', id)
    .maybeSingle();
  const sourcePo = (Array.isArray(source?.po) ? source?.po[0] : source?.po) as { id: string; intake_number: string } | undefined;

  // 생산 공장(오창 · 외주) · 발주서를 올린 사람 (2026-11-02 요청)
  const [user, contacts] = await Promise.all([getCurrentUser(), contactsForWorkOrders(supabase, [id])]);
  const site = toWorkOrderSite(workOrder);
  const contact = contacts.get(id) ?? null;
  const canEditSite = !!user && hasAnyPermission(user, SITE_EDITORS);
  const canAssignContact = !!user && hasAnyPermission(user, CONTACT_EDITORS);
  const canRevise = !!user && hasPermission(user, 'work_order:create');
  const canReceive = !!user && hasPermission(user, 'production:input'); // 생산관리부 · 생산부 계정만 (2026-11-12)

  // 납품 · 수신 확인 — 표가 생기기 전에는 비어 있다
  const [{ storage: deliveryStorage, logs: deliveryLogs }, { storage: receiptStorage, receipts }] = await Promise.all([
    loadDeliveries(supabase, [id]), loadReceipts(supabase, [id]),
  ]);
  const totalDelivered = deliveryLogs.reduce((s, l) => s + l.quantity, 0);
  const deliveryDays = groupDeliveries(deliveryLogs);
  const receipt = receipts.get(id);

  const meta = [
    { label: '의뢰일', value: workOrder.request_date },
    { label: '납품일', value: workOrder.delivery_date || order?.delivery_date || '-' },
    { label: '작성', value: order?.creator?.name ?? 'ERP 작업의뢰서' },
    { label: '시스템 등록', value: formatKst(workOrder.created_at as string) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        back={{ href: '/work-orders', label: '작업의뢰서 목록' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            작업의뢰서 {workOrder.work_order_number}
            <WorkOrderStatusBadge status={workOrder.status} totals={{ quantity: totalQty, produced: totalProduced, delivered: totalDelivered }} />
          </span>
        }
        description={
          <>
            {labels.heading}
            {sourcePo && (
              <Link href={`/purchase-orders/${sourcePo.id}`} className="ml-2 inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800 hover:underline">
                발주 {sourcePo.intake_number} · {source!.label}
                {(source!.check_result as { ok?: boolean } | null)?.ok === false && <span className="text-destructive">· ERP 엑셀과 다름</span>}
              </Link>
            )}
          </>
        }
        actions={
          <>
            {canRevise && <WorkOrderEditActions id={id} number={workOrder.work_order_number} />}
            <Link href={`/work-orders/${id}/preview`} className={buttonVariants({ variant: 'outline' })}>
              <FileText />의뢰서 보기
            </Link>
            <Link href={`/cutting/${id}`} className={buttonVariants({ variant: 'outline' })}>
              <Scissors />재단 입력
            </Link>
            <Link href={`/deliveries/${id}`} className={buttonVariants({ variant: 'outline' })}>
              <Truck />납품 입력
            </Link>
            <Link href={`/production/${id}`} className={buttonVariants({ size: 'lg' })}>
              <Factory />생산 입력
            </Link>
          </>
        }
      />

      {/* 요약 — 날짜 · 진행률 */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-[repeat(4,auto)_1fr] md:items-center">
          {meta.map(m => (
            <div key={m.label}>
              <p className="text-xs font-semibold text-muted-foreground">{m.label}</p>
              <p className="tabular mt-1 font-semibold">{m.value}</p>
            </div>
          ))}
          <div className="col-span-2 md:col-span-1 md:border-l md:pl-6">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-xs font-semibold text-muted-foreground">전체 생산 진행률</p>
              <p className="tabular text-sm">
                <b className="text-base">{totalProduced}</b>
                <span className="text-muted-foreground"> / {totalQty}조</span>
              </p>
            </div>
            <Progress value={overallProgress} />
          </div>
        </CardContent>
      </Card>

      {/* 생산관리부가 받았는지 — 회의: 언제 받았는지 시각까지 남아야 한다 */}
      {receiptStorage === 'db' && site.site !== 'outsource' && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">생산관리부 수신 확인</p>
              {receipt
                ? <p className="tabular mt-1 font-semibold">{formatKst(receipt.received_at)}{receipt.received_by_name && <span className="ml-2 font-medium text-muted-foreground">{receipt.received_by_name}</span>}</p>
                : <p className="mt-1 font-semibold text-warning">미확인</p>}
            </div>
            {!receipt && canReceive && <ReceiptButton workOrderId={id} />}
          </CardContent>
        </Card>
      )}

      {/* 어디서 만드는가 · 누구에게 물어보나 */}
      <Card>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">생산 공장</p>
            <SiteEditor workOrderId={id} value={site} partnerId={(workOrder.outsource_partner_id as string | null) ?? null} canEdit={canEditSite} />
          </div>
          <ContactCard contact={contact} siteLabel={labels.site} canAssign={canAssignContact} />
        </CardContent>
      </Card>

      {/* 품목 — 작업의뢰서 종이 그대로(No · 품명 · 규격 · 수량 · 면적 · 비고, 품명은 덩어리 첫 줄에만, 분홍 소계) + 오른쪽 생산 */}
      <Card className="gap-0 pb-0">
        <CardHeader className="border-b">
          <CardTitle className="text-lg">품목별 생산 현황 <span className="font-normal text-muted-foreground">{woItems.length}건</span></CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="[&_td+td]:border-l [&_th+th]:border-l">
            <TableHeader>
              <TableRow>
                <TableHead colSpan={6} className="h-8 text-center text-xs font-semibold text-muted-foreground">작업의뢰서</TableHead>
                <TableHead colSpan={3} className="h-8 bg-brand-50 text-center text-xs font-semibold text-brand-800">생산</TableHead>
              </TableRow>
              <TableRow>
                <TableHead className="w-12 text-center">No</TableHead>
                <TableHead className="w-[210px] text-center">품명</TableHead>
                <TableHead className="w-32 text-center">규격</TableHead>
                <TableHead className="w-14 text-center">수량</TableHead>
                <TableHead className="w-16 text-center">면적(M²)</TableHead>
                <TableHead className="w-[26%] text-center">비고</TableHead>
                <TableHead className="w-16 bg-brand-50 text-center">완료</TableHead>
                <TableHead className="w-16 bg-brand-50 text-center">잔여</TableHead>
                <TableHead className="w-32 bg-brand-50 text-center">진행률</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {woItems.map((item, idx) => {
                const remaining = item.quantity - item.produced_quantity;
                const progress = item.quantity > 0 ? Math.round(item.produced_quantity / item.quantity * 100) : 0;
                const isComplete = remaining <= 0;
                const head = blockStarts.get(idx);
                const end = blockEnds.get(idx);
                return (
                  <Fragment key={item.id}>
                  <TableRow className={cn(isComplete && 'bg-success-50/50')}>
                    <TableCell className="tabular text-center font-semibold">{itemNo(item, idx)}</TableCell>
                    <TableCell className="max-w-[240px] whitespace-normal break-keep text-[13px] font-semibold leading-snug">{head ? item.product_name : ''}</TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right">{sizeText(item.width_mm, item.height_mm)}</TableCell>
                    <TableCell className="tabular text-right">{item.quantity}</TableCell>
                    <TableCell className="tabular text-right">{Number(item.area_m2 || 0).toFixed(2)}</TableCell>
                    <TableCell className="whitespace-normal"><RemarkText text={item.remark} /></TableCell>
                    <TableCell className="tabular text-right">{item.produced_quantity}</TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {isComplete ? <span className="inline-flex items-center gap-0.5 text-xs text-success"><CheckCircle className="h-3.5 w-3.5" />완료</span> : remaining}
                    </TableCell>
                    <TableCell><Progress value={progress} /></TableCell>
                  </TableRow>
                  {end && (
                    <TableRow className="bg-destructive/[0.07] text-[13px] hover:bg-destructive/[0.07]">
                      <TableCell className="text-center font-semibold">소계</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="tabular text-right font-semibold">{end.quantity}</TableCell>
                      <TableCell className="tabular text-right font-semibold">{end.area_m2.toFixed(2)}</TableCell>
                      <TableCell />
                      <TableCell className="tabular text-right font-semibold">{end.produced}</TableCell>
                      <TableCell className="tabular text-right font-semibold">{end.quantity - end.produced}</TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 생산 이력 + 재단 이력 */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card className="gap-0 pb-0">
          <CardHeader className="border-b">
            <CardTitle className="text-lg">날짜별 생산</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ProductionByDate logs={productionLogs ?? []} items={woItems} compact />
          </CardContent>
        </Card>

        {deliveryStorage === 'db' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">날짜별 납품 <span className="font-normal text-muted-foreground">{totalDelivered} / {totalQty}조</span></CardTitle>
              <CardAction>
                <Link href={`/deliveries/${id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}><Truck />납품 입력</Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              {deliveryDays.length === 0 ? <EmptyBox text="납품 기록이 없습니다" /> : (
                <div className="divide-y rounded-lg border">
                  {deliveryDays.map(day => (
                    <div key={day.date} className="tabular flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                      <span className="font-semibold">{day.date}</span>
                      <span><b className="text-brand-800">{day.quantity}조</b><span className="ml-2 text-muted-foreground">{day.area_m2.toFixed(2)}M²</span></span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">재단 이력 <span className="font-normal text-muted-foreground">
              {cuttingCount}건{cuttingCount > (cuttingLogs ?? []).length && ` · 최근 ${(cuttingLogs ?? []).length}건만 보입니다`}
            </span></CardTitle>
          </CardHeader>
          <CardContent>
            {(!cuttingLogs || cuttingLogs.length === 0) ? (
              <EmptyBox text="재단 이력이 없습니다" />
            ) : (
              <div className="divide-y rounded-lg border">
                {cuttingLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <div className="min-w-0 truncate">
                      <span className="tabular font-semibold">{log.cutting_date}</span>
                      <span className="ml-2">{log.product_name}</span>
                      <span className="ml-1 font-semibold text-brand-800">×{log.quantity}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {log.raw_glass_type && <span>원판 {log.raw_glass_type} ×{log.raw_quantity}</span>}
                      {log.is_manual && <Badge variant="warning">오도시</Badge>}
                      <span>{log.shift === 'night' ? '야간' : '주간'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">{text}</div>
  );
}
