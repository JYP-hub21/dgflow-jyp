import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { logEvent } from '@/lib/purchase-order/server';
import { MANUAL_SHEET, siteScore } from '@/lib/purchase-order/manual';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const LINKERS = ['order:process', 'work_order:create'];

/**
 * 작업의뢰서를 발주 건에 바로 잇기 — 우리 ERP 변환기를 안 써도 (lib/purchase-order/manual.ts).
 *   GET  → { candidates }  아직 어느 발주 건에도 안 이어진 작업의뢰서, 현장명이 닮은 것부터
 *   POST {work_order_id}  → '직접 연결' 포장을 만들어 잇는다
 */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/purchase-orders/[id]/direct-link'>) {
  const user = await getCurrentUser();
  if (!user) return bad('Unauthorized', 401);
  if (!hasAnyPermission(user, LINKERS)) return bad('작업의뢰서를 연결할 권한이 없습니다.', 403);
  const { id } = await ctx.params;
  const supabase = createServiceRoleClient();

  const { data: po } = await supabase.from('dgflow_purchase_orders').select('site_name, customer_name').eq('id', id).maybeSingle();
  if (!po) return bad('발주 건을 찾을 수 없습니다.', 404);

  const [{ data: wos }, { data: taken }] = await Promise.all([
    supabase.from('dgflow_work_orders')
      .select('id, work_order_number, created_at, delivery_date, customer_label, site_label, order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name)), items:dgflow_work_order_items(quantity)')
      .order('created_at', { ascending: false })
      .limit(300),
    supabase.from('dgflow_purchase_order_packages').select('work_order_id').not('work_order_id', 'is', null),
  ]);
  const used = new Set((taken ?? []).map(t => t.work_order_id as string));
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
  if (typeof work_order_id !== 'string') return bad('작업의뢰서를 고르세요.');
  const supabase = createServiceRoleClient();

  const { data: po } = await supabase.from('dgflow_purchase_orders').select('id, stage, assignee_id').eq('id', id).maybeSingle();
  if (!po) return bad('발주 건을 찾을 수 없습니다.', 404);
  if (po.stage === 'cancelled') return bad('취소된 발주 건입니다.');

  const { data: wo } = await supabase
    .from('dgflow_work_orders').select('id, work_order_number, items:dgflow_work_order_items(quantity)').eq('id', work_order_id).maybeSingle();
  if (!wo) return bad('작업의뢰서를 찾을 수 없습니다.', 404);
  const { data: taken } = await supabase
    .from('dgflow_purchase_order_packages').select('id, label').eq('work_order_id', wo.id).maybeSingle();
  if (taken) return bad(`작업의뢰서 ${wo.work_order_number} 는 이미 다른 발주 건(${taken.label})에 연결돼 있습니다.`, 409);

  const { data: last } = await supabase
    .from('dgflow_purchase_order_packages').select('seq').eq('purchase_order_id', id).eq('sheet_name', MANUAL_SHEET)
    .order('seq', { ascending: false }).limit(1).maybeSingle();
  const now = new Date().toISOString();
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

  // 아직 '확인 전' 이었으면 — 담당 부서가 손을 댔으니 확인으로 친다
  if (po.stage === 'submitted') {
    await supabase.from('dgflow_purchase_orders')
      .update({ stage: 'checked', checked_at: now, checked_by: user.id, assignee_id: po.assignee_id ?? user.id, updated_at: now })
      .eq('id', id).eq('stage', 'submitted');
    await logEvent(supabase, id, user.id, 'checked');
  }
  await logEvent(supabase, id, user.id, 'linked', {
    package: '이 발주서에 바로', work_order_number: wo.work_order_number, summary: 'ERP 엑셀 없이 (대조 없음)',
  });
  return NextResponse.json({ success: true });
}
