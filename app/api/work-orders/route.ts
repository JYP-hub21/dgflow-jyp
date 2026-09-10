import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { NextRequest, NextResponse } from 'next/server';
import { format } from 'date-fns';

// POST: 주문 → 작업의뢰서 자동 생성
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { order_id } = await request.json();
  const supabase = createServiceRoleClient();

  // 주문 확인
  const { data: order } = await supabase
    .from('dgflow_orders')
    .select('*, items:dgflow_order_items(*)')
    .eq('id', order_id)
    .single();

  const allowedStatuses = ['final_approved', 'erp_completed'];
  if (!order || !allowedStatuses.includes(order.status)) {
    return NextResponse.json({ error: '최종승인 또는 ERP 입력 완료 상태에서만 작업의뢰서를 생성할 수 있습니다.' }, { status: 400 });
  }

  // 의뢰번호 채번: YY-NNNN
  const year = format(new Date(), 'yy');
  const { data: seqData } = await supabase.rpc('exec_sql', {
    query: `SELECT nextval('dgflow_work_order_seq') as seq`,
  });
  const seq = seqData?.[0]?.seq || 1;
  const workOrderNumber = `${year}-${String(seq).padStart(4, '0')}`;

  // 작업의뢰서 생성
  const { data: workOrder, error: woError } = await supabase
    .from('dgflow_work_orders')
    .insert({
      order_id,
      work_order_number: workOrderNumber,
      request_date: order.order_date,
      delivery_date: order.delivery_date,
    })
    .select()
    .single();

  if (woError) return NextResponse.json({ error: woError.message }, { status: 500 });

  // 작업의뢰서 품목 복사
  const items = (order.items || []) as { product_id: string; product_name: string; width_mm: number; height_mm: number; quantity: number; remark: string; sort_order: number }[];
  const woItems = items.map((item, idx) => ({
    work_order_id: workOrder.id,
    product_id: item.product_id,
    product_name: item.product_name,
    width_mm: item.width_mm,
    height_mm: item.height_mm,
    quantity: item.quantity,
    remark: item.remark,
    sort_order: idx,
  }));

  await supabase.from('dgflow_work_order_items').insert(woItems);

  // 주문 상태 변경
  await supabase.from('dgflow_orders').update({ status: 'work_order_created' }).eq('id', order_id);
  await supabase.from('dgflow_order_status_logs').insert({
    order_id, from_status: order.status, to_status: 'work_order_created',
    changed_by: user.id, comment: `작업의뢰서 ${workOrderNumber} 생성`,
  });

  return NextResponse.json({ data: workOrder }, { status: 201 });
}

// GET: 작업의뢰서 목록
export async function GET() {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('dgflow_work_orders')
    .select(`
      *,
      order:dgflow_orders(order_number, customer:dgflow_customers(short_name), site:dgflow_sites(site_name))
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // order null인 경우 자체 customer_name/site_name 사용하도록 정규화
  const normalized = (data || []).map(wo => {
    const order = wo.order as { order_number: string; customer: { short_name: string }; site: { site_name: string } } | null;
    return {
      ...wo,
      display_customer: order?.customer?.short_name || wo.customer_name || '-',
      display_site: order?.site?.site_name || wo.site_name || '-',
    };
  });

  return NextResponse.json({ data: normalized });
}
