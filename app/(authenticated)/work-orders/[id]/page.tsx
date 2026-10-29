import { createServiceRoleClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { workOrderLabels } from '@/lib/work-order/labels';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Progress from '@/components/ui/progress';
import PageHeader from '@/components/layout/PageHeader';
import WorkOrderStatusBadge from '@/components/work-order/WorkOrderStatusBadge';
import { Factory, Scissors, FileText, CheckCircle } from 'lucide-react';

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceRoleClient();

  // 작업의뢰서 기본 정보
  const { data: workOrder } = await supabase
    .from('dgflow_work_orders')
    .select(`
      *,
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
  const totalQty = woItems.reduce((s, i) => s + i.quantity, 0);
  const totalProduced = woItems.reduce((s, i) => s + i.produced_quantity, 0);
  const overallProgress = totalQty > 0 ? Math.round(totalProduced / totalQty * 100) : 0;

  // 복층 생산 이력
  const { data: productionLogs } = await supabase
    .from('dgflow_production_logs')
    .select('*, created_by_user:dgflow_users!created_by(name)')
    .eq('work_order_id', id)
    .order('production_date', { ascending: false })
    .limit(20);

  // 재단 이력
  const { data: cuttingLogs } = await supabase
    .from('dgflow_cutting_logs')
    .select('*, created_by_user:dgflow_users!created_by(name)')
    .eq('work_order_id', id)
    .order('cutting_date', { ascending: false })
    .limit(20);

  // 이 작업의뢰서가 나온 발주 건 (ERP 업로드 엑셀의 포장)
  const { data: source } = await supabase
    .from('dgflow_purchase_order_packages')
    .select('label, check_result, po:dgflow_purchase_orders(id, intake_number)')
    .eq('work_order_id', id)
    .maybeSingle();
  const sourcePo = (Array.isArray(source?.po) ? source?.po[0] : source?.po) as { id: string; intake_number: string } | undefined;

  const meta = [
    { label: '의뢰일', value: workOrder.request_date },
    { label: '납품일', value: workOrder.delivery_date || order?.delivery_date || '-' },
    { label: '작성', value: order?.creator?.name ?? 'ERP 작업의뢰서' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        back={{ href: '/work-orders', label: '작업의뢰서 목록' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            작업의뢰서 {workOrder.work_order_number}
            <WorkOrderStatusBadge status={workOrder.status} />
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
            <Link href={`/work-orders/${id}/preview`} className={buttonVariants({ variant: 'outline' })}>
              <FileText />의뢰서 보기
            </Link>
            <Link href={`/cutting/${id}`} className={buttonVariants({ variant: 'outline' })}>
              <Scissors />재단 입력
            </Link>
            <Link href={`/production/${id}`} className={buttonVariants({ size: 'lg' })}>
              <Factory />생산 입력
            </Link>
          </>
        }
      />

      {/* 요약 — 날짜 · 진행률 */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-[repeat(3,auto)_1fr] md:items-center">
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
                <span className="text-muted-foreground"> / {totalQty}장</span>
              </p>
            </div>
            <Progress value={overallProgress} />
          </div>
        </CardContent>
      </Card>

      {/* 품목별 진행률 */}
      <Card className="gap-0 pb-0">
        <CardHeader className="border-b">
          <CardTitle className="text-lg">품목별 생산 현황 <span className="font-normal text-muted-foreground">{woItems.length}건</span></CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 pl-5">No</TableHead>
                <TableHead>품명</TableHead>
                <TableHead className="text-right">규격 (mm)</TableHead>
                <TableHead className="text-right">의뢰</TableHead>
                <TableHead className="text-right">완료</TableHead>
                <TableHead className="text-right">잔여</TableHead>
                <TableHead className="w-48 pr-5">진행률</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {woItems.map((item, idx) => {
                const remaining = item.quantity - item.produced_quantity;
                const progress = item.quantity > 0 ? Math.round(item.produced_quantity / item.quantity * 100) : 0;
                const isComplete = remaining <= 0;
                return (
                  <TableRow key={item.id} className={cn(isComplete && 'bg-success-50/60')}>
                    <TableCell className="tabular pl-5 text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-semibold">{item.product_name}</TableCell>
                    <TableCell className="tabular text-right">{item.width_mm} × {item.height_mm}</TableCell>
                    <TableCell className="tabular text-right">{item.quantity}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{item.produced_quantity}</TableCell>
                    <TableCell className="tabular text-right font-bold">
                      {isComplete ? <Badge variant="success"><CheckCircle />완료</Badge> : remaining}
                    </TableCell>
                    <TableCell className="pr-5"><Progress value={progress} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 생산 이력 + 재단 이력 */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">복층 생산 이력 <span className="font-normal text-muted-foreground">{(productionLogs || []).length}건</span></CardTitle>
          </CardHeader>
          <CardContent>
            {(!productionLogs || productionLogs.length === 0) ? (
              <EmptyBox text="생산 이력이 없습니다" />
            ) : (
              <div className="divide-y rounded-lg border">
                {productionLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <div className="tabular">
                      <span className="font-semibold">{log.production_date}</span>
                      <span className="ml-2 font-semibold text-brand-800">{log.quantity_completed}장</span>
                      {log.area_m2 && <span className="ml-1 text-muted-foreground">({Number(log.area_m2).toFixed(1)}m²)</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{log.shift === 'night' ? '야간' : '주간'} · {log.line_number}호기</span>
                      <span>{(log.created_by_user as { name: string } | null)?.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">재단 이력 <span className="font-normal text-muted-foreground">{(cuttingLogs || []).length}건</span></CardTitle>
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
