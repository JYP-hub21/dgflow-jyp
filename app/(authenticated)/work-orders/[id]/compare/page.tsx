import { createServiceRoleClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Factory } from 'lucide-react';
import CompareView, { type CompareOrderItem, type CompareWoItem } from '@/components/work-order/CompareView';

/**
 * 원본 발주의뢰서 ↔ 작업의뢰서 대조.
 *
 * 발주서는 수백 줄인데 작업의뢰서는 수십 줄로 묶이므로, 기본은 묶음 단위로
 * 접어서 보여 준다. 한 줄을 펼치면 그 줄에 묶인 발주 품목이 나온다.
 * 좌우로 나란히 놓고 보고 싶으면 화면에서 전환할 수 있다.
 */
export default async function WorkOrderComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceRoleClient();

  const { data: workOrder } = await supabase
    .from('dgflow_work_orders')
    .select(`
      id, work_order_number, request_date, delivery_date, status, source,
      customer_name, site_name, order_id,
      items:dgflow_work_order_items(*),
      order:dgflow_orders(
        id, order_number, order_date, delivery_date,
        customer:dgflow_customers(name, short_name),
        site:dgflow_sites(site_name),
        items:dgflow_order_items(*)
      )
    `)
    .eq('id', id)
    .single();

  if (!workOrder) notFound();

  const order = workOrder.order as unknown as {
    id: string; order_number: string; order_date: string;
    customer: { name: string; short_name: string } | null;
    site: { site_name: string } | null;
    items: CompareOrderItem[];
  } | null;

  const woItems = ((workOrder.items || []) as CompareWoItem[]).sort((a, b) => a.sort_order - b.sort_order);
  const orderItems = (order?.items || []).slice().sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-5 p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/work-orders/${id}`} className="mb-2 inline-flex items-center text-sm text-gray-500 hover:text-gray-900">
            <ArrowLeft className="mr-1 h-4 w-4" />작업의뢰서로
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">원본 대조</h1>
          <p className="mt-1 text-sm text-gray-600">
            {order?.order_number ? `발주 ${order.order_number}` : '발주서 없음 (엑셀 업로드로 만든 의뢰서)'} ·
            {' '}의뢰번호 {workOrder.work_order_number} ·
            {' '}{order?.customer?.short_name || workOrder.customer_name || '-'} ·
            {' '}{order?.site?.site_name || workOrder.site_name || '-'}
          </p>
        </div>
        <div className="flex gap-2">
          {order && (
            <Link href={`/orders/${order.id}`}>
              <Button variant="outline" size="sm">발주의뢰서 보기</Button>
            </Link>
          )}
          <Link href={`/production/${id}`}>
            <Button size="sm"><Factory className="mr-2 h-4 w-4" />생산 입력</Button>
          </Link>
        </div>
      </div>

      {orderItems.length === 0 ? (
        <p className="rounded-lg border bg-white px-6 py-16 text-center text-sm text-gray-500">
          주문서 없이 엑셀로 올린 작업의뢰서라 대조할 원본이 없습니다.
        </p>
      ) : (
        <CompareView orderItems={orderItems} woItems={woItems} />
      )}
    </div>
  );
}
