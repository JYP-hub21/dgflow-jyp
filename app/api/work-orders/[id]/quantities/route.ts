import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isMesWorkOrder, setMesItemQuantity } from '@/lib/production/mes-quantity';

/**
 * PATCH /api/work-orders/[id]/quantities — MES 로 만든 작업의뢰서의 품목 수량을 상세 화면에서 바로 고친다 (2026-11-16 사용자
 * "ERP 의뢰 수량과 달라도 … 수정할 수 있게 모든 곳에 구현을 해 놔"). body: { items: [{ id, quantity }] }
 * 의뢰 수량과 생산 기록 합을 함께 맞춘다(lib/production/mes-quantity.ts). 생산 입력 · 작업의뢰서 등록 권한 중 하나면 된다 —
 * 생산부도 업무지원부도 MES 수량이 틀린 것을 보면 고칠 수 있게. 일반 의뢰서는 수정 화면(같은 의뢰번호로 다시 등록)에서 고친다.
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasAnyPermission(user, ['production:input', 'work_order:create'])) {
    return NextResponse.json({ error: '수량을 고칠 권한이 없습니다.' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null) as { items?: { id?: unknown; quantity?: unknown }[] } | null;
  const items = Array.isArray(body?.items) ? body!.items : [];
  if (items.length === 0 || items.length > 2000) return NextResponse.json({ error: '고칠 품목이 없습니다.' }, { status: 400 });
  for (const it of items) {
    if (typeof it?.id !== 'string' || !Number.isInteger(it.quantity) || (it.quantity as number) < 1 || (it.quantity as number) > 100_000) {
      return NextResponse.json({ error: '수량은 1 이상의 정수여야 합니다.' }, { status: 400 });
    }
  }

  const supabase = createServiceRoleClient();
  if (!(await isMesWorkOrder(supabase, id))) {
    return NextResponse.json({ error: 'MES 생산실적으로 만든 작업의뢰서만 여기서 고칩니다. 다른 의뢰서는 수정 화면에서 고치세요.' }, { status: 400 });
  }
  const { data: own, error } = await supabase.from('dgflow_work_order_items').select('id').eq('work_order_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const mine = new Set((own ?? []).map(r => r.id as string));
  if (items.some(it => !mine.has(it.id as string))) return NextResponse.json({ error: '이 작업의뢰서의 품목이 아닙니다.' }, { status: 400 });

  let changed = 0;
  try {
    for (const it of items) { await setMesItemQuantity(supabase, it.id as string, it.quantity as number); changed++; }
  } catch (e) {
    return NextResponse.json({ error: `${changed}건을 고친 뒤 멈췄습니다: ${e instanceof Error ? e.message : ''}` }, { status: 500 });
  }
  await supabase.from('dgflow_work_orders').update({ updated_at: new Date().toISOString() }).eq('id', id);
  return NextResponse.json({ changed });
}
