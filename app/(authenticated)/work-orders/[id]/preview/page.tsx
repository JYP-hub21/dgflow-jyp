import { createServiceRoleClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import WorkOrderSheet, { type SheetData } from '@/components/work-order/WorkOrderSheet';
import WorkOrderPdfButton from '@/components/work-order/WorkOrderPdfButton';

export default async function WorkOrderPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceRoleClient();

  const { data: workOrder } = await supabase
    .from('dgflow_work_orders')
    .select(`*, order:dgflow_orders(customer:dgflow_customers(name), site:dgflow_sites(site_name))`)
    .eq('id', id)
    .single();

  if (!workOrder) notFound();

  const { data: items } = await supabase
    .from('dgflow_work_order_items')
    .select('item_no, product_name, width_mm, height_mm, quantity, area_m2, remark, sort_order')
    .eq('work_order_id', id)
    .order('sort_order');

  // 의뢰서에 찍히는 이름은 작업의뢰서가 직접 들고 있고, 없으면 마스터 값으로 채운다
  const order = workOrder.order as { customer?: { name: string }; site?: { site_name: string } } | null;

  const data: SheetData = {
    work_order_number: workOrder.work_order_number,
    customer_label: workOrder.customer_label || order?.customer?.name || '',
    site_label: workOrder.site_label || order?.site?.site_name || '',
    request_date: workOrder.request_date,
    delivery_date: workOrder.delivery_date,
    packaging_group: workOrder.packaging_group,
    // '지난 작업의뢰서 가져오기' 가 notes 에 남기는 내부 메모(ERP 주문번호 · 가져온 날)는 종이에 찍지 않는다 (2026-11-10 점검)
    notes: /지난 작업의뢰서 가져오기/.test(workOrder.notes ?? '') ? null : workOrder.notes,
    items: (items ?? []) as SheetData['items'],
  };

  return (
    <div className="space-y-4 print:space-y-0">
      {/* 작업의뢰서만 여백 0 — 쪽(.wo-page) 안에 여백을 그려 두었다. 다른 화면 인쇄는 기본 여백을 쓴다 */}
      <style>{'@page { size: A4 portrait; margin: 0; }'}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/work-orders/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-2 text-muted-foreground' })}>
            <ChevronLeft />작업의뢰서로
          </Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight md:text-[26px]">작업의뢰서 {data.work_order_number}</h1>
        </div>
        <WorkOrderPdfButton targetId="work-order-sheet" fileName={`작업의뢰서_${data.work_order_number}`} />
      </div>

      <div className="flex justify-center overflow-x-auto print:block print:overflow-visible">
        <WorkOrderSheet data={data} />
      </div>
    </div>
  );
}
