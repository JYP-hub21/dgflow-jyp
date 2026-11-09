import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { DELIVERY_TABLE } from '@/lib/production/delivery';
import { syncWorkOrderStatus } from '@/lib/work-order/stage';

// DELETE: 잘못 넣은 납품 기록 지우기
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:input')) {
    return NextResponse.json({ error: '납품 수량을 입력할 권한이 없습니다.' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const supabase = createServiceRoleClient();
  const { data: log } = await supabase.from(DELIVERY_TABLE).select('work_order_id').eq('id', id).maybeSingle();
  if (!log) return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 });
  const { error } = await supabase.from(DELIVERY_TABLE).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await syncWorkOrderStatus(supabase, log.work_order_id);
  return NextResponse.json({ ok: true });
}
