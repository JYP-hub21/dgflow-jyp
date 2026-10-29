import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { calculateItemArea, syncProducedQuantity } from '@/lib/production/produced-quantity';
import { NextRequest, NextResponse } from 'next/server';

// PATCH: 저장한 생산 기록 고치기 (수량·생산일자·주야간·호기)
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/production/[id]'>) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:input')) {
    return NextResponse.json({ error: '생산 실적을 입력할 권한이 없습니다.' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const { quantity_completed, production_date, shift, line_number } = await request.json();

  const qty = Number(quantity_completed);
  if (!Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json({ error: '수량은 1 이상이어야 합니다. 없앨 기록은 삭제하세요.' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const { data: log } = await supabase
    .from('dgflow_production_logs')
    .select('id, work_order_item_id')
    .eq('id', id)
    .single();
  if (!log) return NextResponse.json({ error: '기록을 찾을 수 없습니다' }, { status: 404 });

  // 고친 뒤 생산 합계가 의뢰 수량을 넘으면 막는다
  if (log.work_order_item_id) {
    const [{ data: item }, { data: others }] = await Promise.all([
      supabase.from('dgflow_work_order_items').select('quantity').eq('id', log.work_order_item_id).single(),
      supabase.from('dgflow_production_logs').select('quantity_completed')
        .eq('work_order_item_id', log.work_order_item_id).neq('id', id),
    ]);
    const otherTotal = (others || []).reduce((s, l) => s + l.quantity_completed, 0);
    if (item && otherTotal + qty > item.quantity) {
      return NextResponse.json(
        { error: `의뢰 ${item.quantity}장을 넘습니다 (다른 기록 ${otherTotal}장 + ${qty}장)` },
        { status: 400 },
      );
    }
  }

  const area = await calculateItemArea(supabase, log.work_order_item_id, qty);
  const { data, error } = await supabase
    .from('dgflow_production_logs')
    .update({
      quantity_completed: qty,
      area_m2: area,
      ...(production_date && { production_date }),
      ...(shift && { shift }),
      ...(line_number && { line_number: Number(line_number) }),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (log.work_order_item_id) await syncProducedQuantity(supabase, log.work_order_item_id);
  return NextResponse.json({ data });
}

// DELETE: 잘못 넣은 생산 기록 지우기
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/production/[id]'>) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:input')) {
    return NextResponse.json({ error: '생산 실적을 입력할 권한이 없습니다.' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();

  const { data: log } = await supabase
    .from('dgflow_production_logs')
    .select('work_order_item_id')
    .eq('id', id)
    .single();
  if (!log) return NextResponse.json({ error: '기록을 찾을 수 없습니다' }, { status: 404 });

  const { error } = await supabase.from('dgflow_production_logs').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (log.work_order_item_id) await syncProducedQuantity(supabase, log.work_order_item_id);
  return NextResponse.json({ ok: true });
}
