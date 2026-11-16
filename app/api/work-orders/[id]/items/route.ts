import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isMesWorkOrder } from '@/lib/production/mes-quantity';
import { applyMesItems, planMesItems, type MesItemRow } from '@/lib/production/mes-items';
import { kstToday } from '@/lib/kst-date';

/**
 * PATCH /api/work-orders/[id]/items — MES 로 만든 작업의뢰서의 품목을 상세 화면에서 바로 고친다 (2026-11-16 사용자
 * "새로운 품목 추가나 이런 것도 되게 … 작업의뢰서에서도 반영되고 넘버도 추가될 수 있고").
 * body: { update: [{ id, quantity?, product_name?, width_mm?, height_mm? }],
 *         add: [{ item_no, product_name, width_mm, height_mm, quantity, produced_date?, line_number?, shift? }],
 *         remove: [id] }
 * 규칙은 lib/production/mes-items.ts. 생산 입력 · 작업의뢰서 등록 권한 중 하나면 된다(수량 수정과 같다).
 * 일반 의뢰서는 수정 화면(같은 의뢰번호로 다시 등록)에서 고친다.
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasAnyPermission(user, ['production:input', 'work_order:create'])) {
    return NextResponse.json({ error: '품목을 고칠 권한이 없습니다.' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: '바꿀 내용이 없습니다.' }, { status: 400 });

  const supabase = createServiceRoleClient();
  if (!(await isMesWorkOrder(supabase, id))) {
    return NextResponse.json({ error: 'MES 생산실적으로 만든 작업의뢰서만 여기서 고칩니다. 다른 의뢰서는 수정 화면에서 고치세요.' }, { status: 400 });
  }
  const { data: rows, error } = await supabase.from('dgflow_work_order_items')
    .select('id, item_no, sort_order, product_name, width_mm, height_mm, quantity, area_m2')
    .eq('work_order_id', id).order('sort_order').order('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const existing = (rows ?? []) as MesItemRow[];

  const planned = planMesItems(existing, body, kstToday());
  if ('error' in planned) return NextResponse.json({ error: planned.error }, { status: 400 });
  const { plan } = planned;
  if (plan.update.length + plan.add.length + plan.remove.length > 500) {
    return NextResponse.json({ error: '한 번에 500건까지 고칠 수 있습니다.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await applyMesItems(supabase, id, existing, plan, user.id));
  } catch (e) {
    const message = e instanceof Error ? e.message : '품목을 고치지 못했습니다.';
    // 납품 기록 때문에 못 지우는 것은 사용자가 고칠 수 있는 일(400), 나머지는 서버 쪽 문제(500)
    return NextResponse.json({ error: message }, { status: message.startsWith('납품 기록이 있는') ? 400 : 500 });
  }
}
