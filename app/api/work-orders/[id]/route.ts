import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { invalidItems, planRevision, type RevisionInput } from '@/lib/work-order/revise';
import { syncWorkOrderStatus } from '@/lib/work-order/stage';
import { MANUAL_SHEET } from '@/lib/purchase-order/manual';
import { DELIVERY_TABLE } from '@/lib/production/delivery';
import { loadDeliveredByItem } from '@/lib/production/delivery-store';

/**
 * 등록한 작업의뢰서 수정 · 삭제 (2026-11-06 회의 "이미 올린 의뢰서를 수정 · 삭제할 수 있어야").
 *   GET     화면에 불러올 머리글 · 품목
 *   PUT     body: { head, items, apply? } — apply 가 없으면 무엇이 바뀌는지만 돌려준다 (lib/work-order/revise.ts)
 *   DELETE  ?force=1 — 생산 · 재단 기록이 있으면 force 없이는 막고 건수를 돌려준다
 * 등록과 같은 권한(work_order:create).
 */
const ITEM_COLUMNS = 'id, item_no, sort_order, product_name, width_mm, height_mm, quantity, area_m2, remark, produced_quantity';

async function authorize() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!hasPermission(user, 'work_order:create')) {
    return { error: NextResponse.json({ error: '작업의뢰서를 수정할 권한이 없습니다.' }, { status: 403 }) };
  }
  return { user };
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { id } = await ctx.params;
  const supabase = createServiceRoleClient();
  const [{ data: head }, { data: items }] = await Promise.all([
    supabase.from('dgflow_work_orders')
      .select('id, work_order_number, customer_label, site_label, request_date, delivery_date')
      .eq('id', id).maybeSingle(),
    supabase.from('dgflow_work_order_items').select(ITEM_COLUMNS).eq('work_order_id', id).order('sort_order'),
  ]);
  if (!head) return NextResponse.json({ error: '작업의뢰서를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ head, items: items ?? [] });
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null) as {
    head?: { customer_label?: string | null; site_label?: string | null; request_date?: string | null; delivery_date?: string | null };
    items?: RevisionInput[];
    apply?: boolean;
  } | null;
  const invalid = invalidItems(body?.items);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const supabase = createServiceRoleClient();
  // 납품 기록이 있는 줄도 생산한 줄처럼 지키려고 품목별 납품량을 같이 읽는다 — 예전에는 생산 기록이 없는 줄을 지우면
  // 그 줄의 납품 기록(외주 · 재고분)이 CASCADE 로 소리 없이 사라졌다 (2026-11-10 점검)
  let delivered: Map<string, number>;
  const [{ data: existing, error: readError }, deliveredRead] = await Promise.all([
    supabase.from('dgflow_work_order_items').select(ITEM_COLUMNS).eq('work_order_id', id),
    loadDeliveredByItem(supabase, id).then(m => ({ m }), (e: unknown) => ({ e })),
  ]);
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if ('e' in deliveredRead) {
    return NextResponse.json({ error: `납품 기록을 읽지 못해 수정을 중단했습니다: ${deliveredRead.e instanceof Error ? deliveredRead.e.message : ''}` }, { status: 500 });
  }
  delivered = deliveredRead.m;

  const plan = planRevision((existing ?? []).map(e => ({ ...e, delivered_quantity: delivered.get(e.id) ?? 0 })), body!.items!);
  if (!body?.apply) return NextResponse.json({ plan });

  const head = body.head ?? {};
  const { error: headError } = await supabase.from('dgflow_work_orders').update({
    ...(head.customer_label !== undefined ? { customer_label: head.customer_label?.trim() || null } : {}),
    ...(head.site_label !== undefined ? { site_label: head.site_label?.trim() || null } : {}),
    ...(head.request_date ? { request_date: head.request_date } : {}),
    ...(head.delivery_date !== undefined ? { delivery_date: head.delivery_date || null } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (headError) return NextResponse.json({ error: headError.message }, { status: 500 });

  for (const u of plan.updates) {
    const { error } = await supabase.from('dgflow_work_order_items').update(u.fields).eq('id', u.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (plan.added.length > 0) {
    const { error } = await supabase.from('dgflow_work_order_items')
      .insert(plan.added.map(a => ({ ...a, work_order_id: id })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (plan.deletes.length > 0) {
    const { error } = await supabase.from('dgflow_work_order_items').delete().in('id', plan.deletes);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await syncWorkOrderStatus(supabase, id);
  return NextResponse.json({ plan });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { id } = await ctx.params;
  const supabase = createServiceRoleClient();
  // 납품 기록도 함께 지워진다(CASCADE) — 예전 경고는 생산 · 재단만 셌다 (2026-11-10 전체 점검)
  const [production, cutting, delivery] = await Promise.all([
    supabase.from('dgflow_production_logs').select('id', { count: 'exact', head: true }).eq('work_order_id', id),
    supabase.from('dgflow_cutting_logs').select('id', { count: 'exact', head: true }).eq('work_order_id', id),
    supabase.from(DELIVERY_TABLE).select('id', { count: 'exact', head: true }).eq('work_order_id', id),
  ]);
  const productionLogs = production.count ?? 0;
  const cuttingLogs = cutting.count ?? 0;
  const deliveryLogs = delivery.error ? 0 : delivery.count ?? 0;
  const force = request.nextUrl.searchParams.get('force') === '1';
  if ((productionLogs > 0 || cuttingLogs > 0 || deliveryLogs > 0) && !force) {
    return NextResponse.json({
      error: '생산 · 재단 · 납품 기록이 있는 작업의뢰서입니다.', code: 'HAS_LOGS', productionLogs, cuttingLogs, deliveryLogs,
    }, { status: 409 });
  }
  // '직접 연결' 포장은 이 의뢰서를 붙이려고 만든 빈 포장이다 — 의뢰서만 지우면(FK SET NULL) 빈 포장이 남아
  // 발주 건이 '작업의뢰서 받는 중' 에서 넘어가지 못하고 화면에서 지울 길도 없었다 → 같이 지운다
  const { error: pkgError } = await supabase.from('dgflow_purchase_order_packages')
    .delete().eq('work_order_id', id).eq('sheet_name', MANUAL_SHEET);
  if (pkgError) return NextResponse.json({ error: pkgError.message }, { status: 500 });
  const { error } = await supabase.from('dgflow_work_orders').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
