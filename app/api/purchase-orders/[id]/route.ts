import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission, ORDER_ANY } from '@/lib/auth/role-guard';
import { canProcess, logEvent } from '@/lib/purchase-order/server';
import { NextRequest, NextResponse } from 'next/server';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * 작업의뢰서 등록 화면이 "어느 발주 건의 어느 포장" 을 채우는지 보여 줄 때 쓴다.
 * 작업의뢰서 등록 권한만 있는 사람도 볼 수 있게 접수번호 · 현장 · 포장 이름만 준다.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/purchase-orders/[id]'>) {
  const user = await getCurrentUser();
  if (!user) return bad('Unauthorized', 401);
  if (!hasAnyPermission(user, [...ORDER_ANY, 'work_order:create'])) return bad('권한이 없습니다.', 403);

  const { id } = await ctx.params;
  const supabase = createServiceRoleClient();
  const { data: po } = await supabase
    .from('dgflow_purchase_orders').select('id, intake_number, customer_name, site_name, due_date').eq('id', id).maybeSingle();
  if (!po) return bad('발주 건을 찾을 수 없습니다.', 404);
  const { data: packages } = await supabase
    .from('dgflow_purchase_order_packages')
    .select('id, label, sheet_name, total_quantity, work_order_id')
    .eq('purchase_order_id', id).order('sheet_name').order('seq');
  return NextResponse.json({ data: { ...po, packages: packages ?? [] } });
}

/**
 * 발주 건 고치기 — 담당자 바꾸기(assignee_id) · 취소(cancel) · 내용 고치기.
 *
 * 담당자를 바꾸면 새 담당자는 아직 안 본 것이므로 "확인 전" 으로 되돌린다.
 * 단 처리 담당자가 "내가 맡기" 로 자기를 지목하면 이미 보고 있는 것이니 바로 확인으로 친다.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/purchase-orders/[id]'>) {
  const user = await getCurrentUser();
  if (!user) return bad('Unauthorized', 401);

  const { id } = await ctx.params;
  const body = await request.json();
  const supabase = createServiceRoleClient();

  const { data: po } = await supabase
    .from('dgflow_purchase_orders').select('id, created_by, assignee_id, stage').eq('id', id).maybeSingle();
  if (!po) return bad('발주 건을 찾을 수 없습니다.', 404);

  const isCreator = po.created_by === user.id;
  const processor = canProcess(user);
  if (!isCreator && !processor) return bad('이 발주 건을 고칠 권한이 없습니다.', 403);

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {};

  if (body.cancel === true) {
    if (!isCreator && user.role !== 'master') return bad('취소는 올린 사람이나 마스터만 할 수 있습니다.', 403);
    const { count } = await supabase.from('dgflow_purchase_order_packages')
      .select('id', { count: 'exact', head: true }).eq('purchase_order_id', id).not('work_order_id', 'is', null);
    if (count) return bad('작업의뢰서가 연결된 건은 취소할 수 없습니다. 연결부터 끊으세요.');
    update.stage = 'cancelled';
    await logEvent(supabase, id, user.id, 'cancelled', { reason: body.reason?.trim() || null });
  }

  if (body.assignee_id !== undefined && body.assignee_id !== po.assignee_id) {
    if (po.stage === 'cancelled') return bad('취소된 건입니다.');
    const { data: next } = await supabase
      .from('dgflow_users').select('id, name, role, permissions, status, is_active').eq('id', body.assignee_id).maybeSingle();
    if (!next || next.status !== 'active' || !next.is_active || !canProcess(next)) {
      return bad('발주서를 처리할 수 있는 사람만 담당자로 고를 수 있습니다.');
    }
    update.assignee_id = next.id;
    if (po.stage === 'submitted' || po.stage === 'checked') {
      const self = next.id === user.id;
      update.stage = self ? 'checked' : 'submitted';
      update.checked_at = self ? now : null;
      update.checked_by = self ? user.id : null;
    }
    await logEvent(supabase, id, user.id, 'assigned', { from: po.assignee_id, to: next.id, to_name: next.name });
  }

  const edits: Record<string, unknown> = {};
  for (const k of ['customer_name', 'site_name', 'memo'] as const) {
    if (typeof body[k] === 'string') edits[k] = body[k].trim() || null;
  }
  if ('due_date' in body) edits.due_date = body.due_date || null;
  if (Object.keys(edits).length > 0) {
    Object.assign(update, edits);
    await logEvent(supabase, id, user.id, 'edited', edits);
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ success: true });
  const { error } = await supabase.from('dgflow_purchase_orders').update({ ...update, updated_at: now }).eq('id', id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ success: true });
}
