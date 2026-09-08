import { createServiceRoleClient } from '@/lib/supabase/server';
import { createNotifications } from '@/lib/notification/create';
import type { OrderStatus } from '@/types/order-status';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { token, order_id, action, comment } = await request.json();

  if (!token || !order_id || !action) {
    return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // 토큰 검증: 존재 여부 + 만료 여부 + 사용 여부
  const { data: tokenData } = await supabase
    .from('dgflow_approval_tokens')
    .select('id, expires_at, used_at, order_id')
    .eq('token', token)
    .single();

  if (!tokenData) {
    return NextResponse.json({ error: '유효하지 않은 토큰입니다.' }, { status: 400 });
  }
  if (tokenData.used_at) {
    return NextResponse.json({ error: '이미 처리된 승인 요청입니다.' }, { status: 400 });
  }
  if (new Date(tokenData.expires_at) < new Date()) {
    return NextResponse.json({ error: '만료된 승인 링크입니다.' }, { status: 400 });
  }
  if (tokenData.order_id !== order_id) {
    return NextResponse.json({ error: '토큰과 주문이 일치하지 않습니다.' }, { status: 400 });
  }

  // 토큰 사용 처리
  await supabase
    .from('dgflow_approval_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenData.id);

  const newStatus: OrderStatus = action === 'approve' ? 'customer_approved' : 'rejected_by_customer';

  // 주문 상태 변경
  await supabase.from('dgflow_orders').update({ status: newStatus }).eq('id', order_id);

  // 승인 이력
  await supabase.from('dgflow_approvals').insert({
    order_id,
    step: 'customer',
    status: action === 'approve' ? 'approved' : 'rejected',
    comment: comment || null,
  });

  // 상태 로그
  await supabase.from('dgflow_order_status_logs').insert({
    order_id,
    from_status: 'pending_customer',
    to_status: newStatus,
    comment: comment || (action === 'approve' ? '고객 승인' : '고객 반려'),
  });

  // 알림 생성 (작성자에게)
  const { data: order } = await supabase
    .from('dgflow_orders').select('created_by').eq('id', order_id).single();
  if (order) {
    await createNotifications(order_id, newStatus, order.created_by);
  }

  return NextResponse.json({ success: true });
}
