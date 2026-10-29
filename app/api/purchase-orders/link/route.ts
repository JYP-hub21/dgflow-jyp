import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { compareSizes, checkSummary } from '@/lib/purchase-order/match';
import { logEvent } from '@/lib/purchase-order/server';
import { NextRequest, NextResponse } from 'next/server';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * 포장 ↔ 작업의뢰서 잇기 / 끊기 (work_order_id 가 null 이면 끊는다).
 * 이을 때 ERP 엑셀과 작업의뢰서의 규격 · 수량을 대조해 결과를 함께 저장한다.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return bad('Unauthorized', 401);
  if (!hasAnyPermission(user, ['order:process', 'work_order:create'])) return bad('작업의뢰서를 연결할 권한이 없습니다.', 403);

  const { package_id, work_order_id } = await request.json();
  const supabase = createServiceRoleClient();

  const { data: pkg } = await supabase
    .from('dgflow_purchase_order_packages').select('id, purchase_order_id, label, rows, work_order_id').eq('id', package_id).maybeSingle();
  if (!pkg) return bad('포장을 찾을 수 없습니다.', 404);

  if (!work_order_id) {
    if (!pkg.work_order_id) return NextResponse.json({ success: true });
    const { data: wo } = await supabase.from('dgflow_work_orders').select('work_order_number').eq('id', pkg.work_order_id).maybeSingle();
    await supabase.from('dgflow_purchase_order_packages')
      .update({ work_order_id: null, linked_at: null, linked_by: null, check_result: null }).eq('id', pkg.id);
    await logEvent(supabase, pkg.purchase_order_id, user.id, 'unlinked', { package: pkg.label, work_order_number: wo?.work_order_number });
    return NextResponse.json({ success: true });
  }

  const { data: wo } = await supabase.from('dgflow_work_orders').select('id, work_order_number').eq('id', work_order_id).maybeSingle();
  if (!wo) return bad('작업의뢰서를 찾을 수 없습니다.', 404);

  const { data: taken } = await supabase
    .from('dgflow_purchase_order_packages').select('id, label').eq('work_order_id', wo.id).maybeSingle();
  if (taken && taken.id !== pkg.id) return bad(`작업의뢰서 ${wo.work_order_number} 는 이미 다른 포장(${taken.label})에 연결돼 있습니다.`, 409);

  const { data: items } = await supabase
    .from('dgflow_work_order_items').select('width_mm, height_mm, quantity').eq('work_order_id', wo.id);
  const check = compareSizes(pkg.rows ?? [], items ?? []);

  const { error } = await supabase.from('dgflow_purchase_order_packages').update({
    work_order_id: wo.id,
    linked_at: new Date().toISOString(),
    linked_by: user.id,
    check_result: check,
  }).eq('id', pkg.id);
  if (error) return bad(error.message, 500);

  await logEvent(supabase, pkg.purchase_order_id, user.id, 'linked', {
    package: pkg.label, work_order_number: wo.work_order_number, ok: check.ok, summary: checkSummary(check),
  });
  return NextResponse.json({ data: { check, summary: checkSummary(check), purchase_order_id: pkg.purchase_order_id } });
}
