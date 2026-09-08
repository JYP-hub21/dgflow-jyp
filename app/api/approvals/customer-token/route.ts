import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { NextRequest, NextResponse } from 'next/server';

// POST: 고객 승인 토큰 생성
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { order_id } = await request.json();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from('dgflow_approval_tokens')
    .insert({ order_id })
    .select('token')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 주문 상태를 고객승인대기로 변경
  await supabase.from('dgflow_orders').update({ status: 'pending_customer' }).eq('id', order_id);
  await supabase.from('dgflow_order_status_logs').insert({
    order_id, from_status: 'draft', to_status: 'pending_customer',
    changed_by: user.id, comment: '고객 승인 요청',
  });

  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  const approvalUrl = `${baseUrl}/approval/${data.token}`;

  return NextResponse.json({ token: data.token, url: approvalUrl });
}
