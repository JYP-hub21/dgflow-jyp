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
    .select('product_name, width_mm, height_mm, quantity, area_m2, remark, sort_order')
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
    notes: workOrder.notes,
    items: (items ?? []) as SheetData['items'],
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/work-orders/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-2 text-muted-foreground' })}>
            <ChevronLeft />작업의뢰서로
          </Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight md:text-[26px]">작업의뢰서 {data.work_order_number}</h1>
        </div>
        <WorkOrderPdfButton targetId="work-order-sheet" fileName={`작업의뢰서_${data.work_order_number}`} />
      </div>

      <div className="flex justify-center overflow-x-auto">
        <div className="shadow-lg print:shadow-none">
          <WorkOrderSheet data={data} />
        </div>
      </div>
    </div>
  );
}
