import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { logEvent } from '@/lib/purchase-order/server';
import { MANUAL_SHEET, isManualPackage, siteScore } from '@/lib/purchase-order/manual';
import { checkSummary, compareSizes } from '@/lib/purchase-order/match';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import { fetchAllIn } from '@/lib/supabase/fetch-all';
import { closestPackage } from './closest';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const LINKERS = ['order:process', 'work_order:create'];

/**
 * 작업의뢰서를 발주 건에 붙이기 (lib/purchase-order/manual.ts) — 작업의뢰서 등록에서 "어느 발주서에서 나온 건가요?" 를 고르거나,
 * 발주서 화면에서 이미 등록한 작업의뢰서를 고를 때.
 *   GET  → { candidates }  아직 어느 발주 건에도 안 붙은 작업의뢰서, 현장명이 닮은 것부터
 *   POST {work_order_id}  → 우리 변환기로 만든 빈 포장이 있으면 규격 · 수량이 맞는 곳(없으면 가장 가까운 곳 — 대조 결과를 남긴다)에,
 *                           빈 포장이 아예 없을 때만 '직접 연결' 포장을 만들어 붙인다
 */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/purchase-orders/[id]/direct-link'>) {
  const user = await getCurrentUser();
  if (!user) return bad('Unauthorized', 401);
  if (!hasAnyPermission(user, LINKERS)) return bad('작업의뢰서를 연결할 권한이 없습니다.', 403);
  const { id } = await ctx.params;
  const supabase = createServiceRoleClient();

  const { data: po } = await supabase.from('dgflow_purchase_orders').select('site_name, customer_name').eq('id', id).maybeSingle();
  if (!po) return bad('발주 건을 찾을 수 없습니다.', 404);

  const { data: wos } = await supabase.from('dgflow_work_orders')
    .select('id, work_order_number, created_at, delivery_date, customer_label, site_label, order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name)), items:dgflow_work_order_items(quantity)')
    .order('created_at', { ascending: false })
    .limit(300);
  // 이미 붙은 작업의뢰서 — 예전에는 연결된 포장 전체를 한 번에 읽어 1,000개에서 조용히 잘렸다(잘린 만큼 이미 붙은 작업의뢰서가 후보로 떴다).
  // 후보 300건 것만 묶음으로 끝까지 읽는다 (2026-11-10 점검)
  const taken = await fetchAllIn<{ work_order_id: string }>((wos ?? []).map(w => w.id as string), (chunk, from, to) =>
    supabase.from('dgflow_purchase_order_packages').select('work_order_id').in('work_order_id', chunk).order('id').range(from, to));
  const used = new Set(taken.map(t => t.work_order_id));
  const candidates = (wos ?? [])
    .filter(w => !used.has(w.id as string))
    .map(w => {
      const labels = workOrderLabels(w as unknown as WorkOrderLabelSource);
      const site = siteScore(po.site_name, labels.site);
      const customer = siteScore(po.customer_name, labels.customer);
      return {
        id: w.id as string, work_order_number: w.work_order_number as string,
        customer: labels.customer, site: labels.site, created_at: w.created_at as string,
        total: ((w.items ?? []) as { quantity: number }[]).reduce((s, i) => s + i.quantity, 0),
        site_score: Math.round(site * 100) / 100,
        customer_score: Math.round(customer * 100) / 100,
      };
    })
    // 현장이 닮은 것 먼저, 그다음 거래처가 같은 것, 그다음 최근 것
    .sort((a, b) => Math.max(b.site_score, 0.6 * b.customer_score) - Math.max(a.site_score, 0.6 * a.customer_score)
      || b.created_at.localeCompare(a.created_at))
    .slice(0, 40);
  return NextResponse.json({ candidates });
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/purchase-orders/[id]/direct-link'>) {
  const user = await getCurrentUser();
  if (!user) return bad('Unauthorized', 401);
  if (!hasAnyPermission(user, LINKERS)) return bad('작업의뢰서를 연결할 권한이 없습니다.', 403);
  const { id } = await ctx.params;
  const { work_order_id } = await request.json().catch(() => ({}));
  if (typeof work_order_id !== 'string') return bad('작업의뢰서를 선택하세요.');
  const supabase = createServiceRoleClient();

  const { data: po } = await supabase.from('dgflow_purchase_orders').select('id, stage, assignee_id').eq('id', id).maybeSingle();
  if (!po) return bad('발주 건을 찾을 수 없습니다.', 404);
  if (po.stage === 'cancelled') return bad('취소된 발주 건입니다.');

  const { data: wo } = await supabase
    .from('dgflow_work_orders').select('id, work_order_number, items:dgflow_work_order_items(quantity)').eq('id', work_order_id).maybeSingle();
  if (!wo) return bad('작업의뢰서를 찾을 수 없습니다.', 404);
  const { data: taken } = await supabase
    .from('dgflow_purchase_order_packages').select('id, label').eq('work_order_id', wo.id).maybeSingle();
  if (taken) return bad(`작업의뢰서 ${wo.work_order_number} 는 이미 다른 발주 건(${taken.label})에 연결되어 있습니다.`, 409);

  const now = new Date().toISOString();

  // 1) 우리 변환기로 만든 빈 포장이 있으면 — 규격 · 수량이 딱 맞는 곳에, 없으면 가장 가까운 곳(./closest.ts)에 붙이고 대조 결과를 남긴다.
  //    예전에는 딱 맞지 않으면 아래 '직접 연결' 로 빠져, 오타 하나 있는 작업의뢰서가 대조 없이 붙고 진짜 포장은
  //    '작업의뢰서 기다리는 중' 에 영영 남고 오타는 어디에도 안 보였다. 이제 그 포장에 'ERP 엑셀과 다름' 이 빨갛게 뜬다 (2026-11-10 점검)
  const { data: open } = await supabase
    .from('dgflow_purchase_order_packages').select('id, label, sheet_name, rows, seq')
    .eq('purchase_order_id', id).is('work_order_id', null).order('seq');
  const converterPkgs = (open ?? []).filter(p => !isManualPackage(p));
  const { data: items } = converterPkgs.length > 0
    ? await supabase.from('dgflow_work_order_items').select('width_mm, height_mm, quantity').eq('work_order_id', wo.id)
    : { data: [] };
  const checked = converterPkgs.map(p => ({ p, check: compareSizes(p.rows ?? [], items ?? []) }));
  const nearest = closestPackage(converterPkgs, items ?? []);
  // 규격이 하나도 겹치지 않으면(nearest 없음) 어느 포장의 것도 아니다 — 아래 '직접 연결' 로
  const match = checked.find(m => m.check.ok) ?? checked.find(m => m.p === nearest);
  if (match) {
    const summary = checkSummary(match.check);
    const { error } = await supabase.from('dgflow_purchase_order_packages').update({
      work_order_id: wo.id, linked_at: now, linked_by: user.id, check_result: match.check,
    }).eq('id', match.p.id);
    if (error) return bad(error.message, 500);
    await markChecked(supabase, po, id, user.id, now);
    await logEvent(supabase, id, user.id, 'linked', {
      package: match.p.label, work_order_number: wo.work_order_number, ok: match.check.ok, summary,
    });
    // ok — 화면이 '연결했지만 ERP 엑셀과 다릅니다' 를 경고로 띄운다
    return NextResponse.json({ success: true, mode: 'package', label: match.p.label, summary, ok: match.check.ok });
  }

  // 2) 빈 ERP 포장이 없거나, 규격이 겹치는 포장이 하나도 없을 때만 '직접 연결' — 대조할 ERP 엑셀 없이
  const { data: last } = await supabase
    .from('dgflow_purchase_order_packages').select('seq').eq('purchase_order_id', id).eq('sheet_name', MANUAL_SHEET)
    .order('seq', { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from('dgflow_purchase_order_packages').insert({
    purchase_order_id: id,
    sheet_name: MANUAL_SHEET,
    seq: (last?.seq ?? 0) + 1,
    label: `작업의뢰서 ${wo.work_order_number}`,
    rows: [],
    total_quantity: ((wo.items ?? []) as { quantity: number }[]).reduce((s, i) => s + i.quantity, 0),
    work_order_id: wo.id,
    linked_at: now,
    linked_by: user.id,
    check_result: null,
  });
  if (error) return bad(error.message, 500);

  await markChecked(supabase, po, id, user.id, now);
  await logEvent(supabase, id, user.id, 'linked', {
    package: '이 발주서', work_order_number: wo.work_order_number, summary: 'ERP 엑셀 대조 없이',
  });
  return NextResponse.json({ success: true, mode: 'manual' });
}

/** 아직 '확인 전' 이었으면 — 담당 부서가 손을 댔으니 확인으로 친다 */
async function markChecked(
  supabase: ReturnType<typeof createServiceRoleClient>, po: { stage: string; assignee_id: string | null },
  id: string, userId: string, now: string,
) {
  if (po.stage !== 'submitted') return;
  await supabase.from('dgflow_purchase_orders')
    .update({ stage: 'checked', checked_at: now, checked_by: userId, assignee_id: po.assignee_id ?? userId, updated_at: now })
    .eq('id', id).eq('stage', 'submitted');
  await logEvent(supabase, id, userId, 'checked');
}
