import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { EDITABLE_STATUSES } from '@/types/order-status';
import { NextRequest, NextResponse } from 'next/server';

// PUT /api/orders/[id] - 주문 수정 (초안/반려 상태에서만)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = await createServerSupabaseClient();

  // 현재 상태 + 작성자 확인
  const { data: order } = await supabase
    .from('dgflow_orders')
    .select('status, created_by')
    .eq('id', id)
    .single();

  if (!order) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });

  // 본인 주문 또는 경영지원팀/시스템관리자만 수정 가능
  const canEdit = order.created_by === user.id || ['biz_support', 'system_admin'].includes(user.role);
  if (!canEdit) {
    return NextResponse.json({ error: '본인이 작성한 주문만 수정할 수 있습니다.' }, { status: 403 });
  }

  const editable = EDITABLE_STATUSES;
  if (!editable.includes(order.status)) {
    return NextResponse.json({ error: '현재 상태에서는 수정할 수 없습니다.' }, { status: 400 });
  }

  const body = await request.json();
  const { customer_id, site_id, order_date, delivery_date, remark, items } = body;

  // 주문 기본정보 수정
  const totalQuantity = items.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0);
  const totalArea = items.reduce((sum: number, item: { width_mm: number; height_mm: number; quantity: number }) =>
    sum + (item.width_mm * item.height_mm * item.quantity / 1_000_000), 0);

  const { error: updateError } = await supabase
    .from('dgflow_orders')
    .update({
      customer_id,
      site_id,
      order_date,
      delivery_date: delivery_date || null,
      remark: remark || null,
      total_quantity: totalQuantity,
      total_area_m2: Math.round(totalArea * 100) / 100,
      status: 'draft', // 수정하면 다시 초안으로
    })
    .eq('id', id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // 기존 품목 삭제 후 재입력
  await supabase.from('dgflow_order_items').delete().eq('order_id', id);

  const orderItems = items.map((item: {
    product_id?: string; product_name: string;
    width_mm: number; height_mm: number; quantity: number;
    location_dong?: string; location_line?: string; location_floor?: string;
    location_room?: string; location_type?: string; location_window_type?: string;
    remark?: string;
  }, index: number) => ({
    order_id: id,
    product_id: item.product_id || null,
    product_name: item.product_name,
    width_mm: item.width_mm,
    height_mm: item.height_mm,
    quantity: item.quantity,
    location_dong: item.location_dong || null,
    location_line: item.location_line || null,
    location_floor: item.location_floor || null,
    location_room: item.location_room || null,
    location_type: item.location_type || null,
    location_window_type: item.location_window_type || null,
    remark: item.remark || null,
    sort_order: index,
  }));

  await supabase.from('dgflow_order_items').insert(orderItems);

  // 상태 로그
  if (order.status !== 'draft') {
    await supabase.from('dgflow_order_status_logs').insert({
      order_id: id,
      from_status: order.status,
      to_status: 'draft',
      changed_by: user.id,
      comment: '주문 수정 (초안으로 복귀)',
    });
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/orders/[id] - 주문 삭제 (초안/반려 상태에서만)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = await createServerSupabaseClient();

  const { data: order } = await supabase
    .from('dgflow_orders')
    .select('status, created_by')
    .eq('id', id)
    .single();

  if (!order) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });

  // 본인 주문 또는 시스템관리자만 삭제 가능
  const canDelete = order.created_by === user.id || user.role === 'system_admin';
  if (!canDelete) {
    return NextResponse.json({ error: '본인이 작성한 주문만 삭제할 수 있습니다.' }, { status: 403 });
  }

  const deletable = EDITABLE_STATUSES;
  if (!deletable.includes(order.status)) {
    return NextResponse.json({ error: '초안 또는 반려 상태에서만 삭제할 수 있습니다.' }, { status: 400 });
  }

  // CASCADE로 order_items, approvals, tokens, status_logs 자동 삭제
  const { error } = await supabase.from('dgflow_orders').delete().eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
