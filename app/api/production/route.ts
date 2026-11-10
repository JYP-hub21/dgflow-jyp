import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { calculateItemArea, syncProducedQuantity } from '@/lib/production/produced-quantity';
import { syncWorkOrderStatus } from '@/lib/work-order/stage';
import { needsReceipt } from '@/lib/work-order/receipts';
import { kstToday } from '@/lib/kst-date';
import { NextRequest, NextResponse } from 'next/server';

// POST: 생산실적 입력
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:input')) {
    return NextResponse.json({ error: '생산 실적을 입력할 권한이 없습니다.' }, { status: 403 });
  }

  const { work_order_id, work_order_item_id, quantity_completed, production_date, log_type, shift, line_number, remark } = await request.json();

  // 생산관리부가 받았다고 확인한 의뢰서에만 생산을 넣는다 (화면도 막지만 서버에서 한 번 더)
  if (work_order_id && await needsReceipt(createServiceRoleClient(), work_order_id)) {
    return NextResponse.json({
      error: '수신 확인 전인 작업의뢰서입니다. 생산관리부가 받았다고 확인한 뒤에 생산을 입력할 수 있습니다.',
      code: 'RECEIPT_REQUIRED',
    }, { status: 409 });
  }

  const supabase = await createServerSupabaseClient();

  // 수량 · 의뢰 수량 넘김 검사 — 고치기(PATCH)에는 있었는데 넣기(POST)에는 없었다. 폰과 PC 가 같은 의뢰서를 열어 둔 채
  // 둘 다 '전량' 을 누르면 20/10 이 됐다 (2026-11-10 전체 점검)
  const qty = Number(quantity_completed);
  if (!Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json({ error: '수량은 1 이상의 정수여야 합니다.' }, { status: 400 });
  }
  if (work_order_item_id) {
    const [{ data: item }, { data: done }] = await Promise.all([
      supabase.from('dgflow_work_order_items').select('quantity, work_order_id').eq('id', work_order_item_id).single(),
      supabase.from('dgflow_production_logs').select('quantity_completed').eq('work_order_item_id', work_order_item_id),
    ]);
    if (!item || item.work_order_id !== work_order_id) {
      return NextResponse.json({ error: '이 작업의뢰서의 품목이 아닙니다.' }, { status: 400 });
    }
    const total = (done || []).reduce((s, l) => s + l.quantity_completed, 0);
    if (total + qty > item.quantity) {
      return NextResponse.json(
        { error: `의뢰 ${item.quantity}조를 넘습니다 (이미 ${total}조 + 이번 ${qty}조). 다른 곳에서 먼저 입력했는지 확인해 주세요.`, code: 'OVER_ORDERED' },
        { status: 400 },
      );
    }
  }

  // 생산 로그 저장
  const area = await calculateItemArea(supabase, work_order_item_id, qty);

  const { data, error } = await supabase
    .from('dgflow_production_logs')
    .insert({
      work_order_id,
      work_order_item_id,
      production_date: production_date || kstToday(),
      log_type: log_type || 'full',
      quantity_completed: qty,
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
  await syncWorkOrderStatus(createServiceRoleClient(), work_order_id);

  return NextResponse.json({ data }, { status: 201 });
}
