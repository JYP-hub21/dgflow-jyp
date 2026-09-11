import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import WorkOrderDraft, { type SourceItem } from '@/components/work-order/WorkOrderDraft';

/**
 * 작업의뢰서 만들기 — 규격별로 묶고, 품명은 담당자가 직접 적는다.
 *
 * 예전에는 최종승인과 동시에 발주 품목을 그대로 복사해 작업의뢰서를 만들었다.
 * 그러면 발주서에 적혀 온 품명이 그대로 생산 현장까지 내려간다.
 * 발주서 표기를 동일유리 용어로 바꾸는 판단은 사람이 해야 하므로,
 * 이 화면에서 담당자가 확인하고 적은 뒤에 만들어진다.
 */
export default async function WorkOrderNewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // 작업의뢰서를 만드는 일은 경영지원팀 몫이다 (시스템관리자는 전부 가능)
  if (!['biz_support', 'system_admin'].includes(user.role)) {
    redirect(`/orders/${id}`);
  }

  const supabase = createServiceRoleClient();
  const { data: order } = await supabase
    .from('dgflow_orders')
    .select(`
      id, order_number, status, order_date, delivery_date,
      customer:dgflow_customers(name, short_name),
      site:dgflow_sites(site_name),
      items:dgflow_order_items(*)
    `)
    .eq('id', id)
    .single();

  if (!order) notFound();

  const allowed = [
    'under_review', 'review_completed', 'pending_approval',
    'rejected_by_admin', 'final_approved', 'erp_completed',
  ];
  if (!allowed.includes(order.status)) {
    return (
      <div className="p-8">
        <h1 className="mb-2 text-xl font-bold text-gray-900">아직 작업의뢰서를 만들 수 없습니다</h1>
        <p className="mb-6 text-sm text-gray-600">
          경영지원팀이 검토를 시작한 뒤부터 작업의뢰서를 만들 수 있습니다. 지금 이 주문은 그 앞 단계에 있습니다.
        </p>
        <Link href={`/orders/${id}`}>
          <Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" />주문으로 돌아가기</Button>
        </Link>
      </div>
    );
  }

  const customer = order.customer as unknown as { name: string; short_name: string } | null;
  const site = order.site as unknown as { site_name: string } | null;
  const items = ((order.items || []) as SourceItem[]).sort(
    (a, b) => a.product_name.localeCompare(b.product_name) || a.width_mm - b.width_mm
  );

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/orders/${id}`} className="mb-2 inline-flex items-center text-sm text-gray-500 hover:text-gray-900">
            <ArrowLeft className="mr-1 h-4 w-4" />주문 상세로
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">작업의뢰서 만들기</h1>
          <p className="mt-1 text-sm text-gray-600">
            {order.order_number || '(주문번호 없음)'} · {customer?.short_name || customer?.name || '-'} · {site?.site_name || '-'}
          </p>
        </div>
      </div>

      <WorkOrderDraft orderId={order.id} orderNumber={order.order_number || ''} items={items} />
    </div>
  );
}
