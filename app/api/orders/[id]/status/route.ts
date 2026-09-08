import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { canTransition, type OrderStatus } from '@/types/order-status';
import { createNotifications } from '@/lib/notification/create';
import { NextRequest, NextResponse } from 'next/server';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { status: newStatus, comment } = await request.json();

  const supabase = await createServerSupabaseClient();

  // 현재 주문 조회
  const { data: order } = await supabase
    .from('dgflow_orders')
    .select('status, created_by')
    .eq('id', id)
    .single();

  if (!order) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
  }

  const currentStatus = order.status as OrderStatus;

  // 상태 전이 규칙 검증
  if (!canTransition(currentStatus, newStatus as OrderStatus)) {
    return NextResponse.json({
      error: `${currentStatus} → ${newStatus} 전이가 허용되지 않습니다.`
    }, { status: 400 });
  }

  // 주문 상태 변경
  const { error: updateError } = await supabase
    .from('dgflow_orders')
    .update({ status: newStatus })
    .eq('id', id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // 상태 로그 기록
  await supabase.from('dgflow_order_status_logs').insert({
    order_id: id,
    from_status: currentStatus,
    to_status: newStatus,
    changed_by: user.id,
    comment: comment || null,
  });

  // 알림 생성
  await createNotifications(id, newStatus as OrderStatus, order.created_by);

  return NextResponse.json({ success: true });
}
