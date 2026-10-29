import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { calculateItemArea, syncProducedQuantity } from '@/lib/production/produced-quantity';
import { NextRequest, NextResponse } from 'next/server';

// POST: 생산실적 입력
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:input')) {
    return NextResponse.json({ error: '생산 실적을 입력할 권한이 없습니다.' }, { status: 403 });
  }

  const { work_order_id, work_order_item_id, quantity_completed, production_date, log_type, shift, line_number, remark } = await request.json();

  const supabase = await createServerSupabaseClient();

  // 생산 로그 저장
  const area = await calculateItemArea(supabase, work_order_item_id, quantity_completed);

  const { data, error } = await supabase
    .from('dgflow_production_logs')
    .insert({
      work_order_id,
      work_order_item_id,
      production_date: production_date || new Date().toISOString().split('T')[0],
      log_type: log_type || 'full',
      quantity_completed,
      area_m2: area,
      shift: shift || 'day',
      line_number: line_number || 1,
      remark,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 작업의뢰서 품목의 생산완료 수량 = 생산 기록의 합
  if (work_order_item_id) await syncProducedQuantity(supabase, work_order_item_id);

  return NextResponse.json({ data }, { status: 201 });
}
