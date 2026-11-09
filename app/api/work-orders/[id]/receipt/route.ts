import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/production/bokcheung-store';
import { RECEIPTS_TABLE } from '@/lib/work-order/receipts';

/**
 * POST /api/work-orders/[id]/receipt — 생산관리부 수신 확인 (2026-11-06 회의).
 * 한 번 확인하면 고치지 않는다: 이 시각이 "언제 받았나" 의 근거다. 두 번 눌러도 처음 시각이 남는다.
 */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:view')) {
    return NextResponse.json({ error: '수신 확인 권한이 없습니다.' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const { error } = await createServiceRoleClient()
    .from(RECEIPTS_TABLE)
    .upsert({ work_order_id: id, received_by: user.id }, { onConflict: 'work_order_id', ignoreDuplicates: true });
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: '수신 기록을 저장할 표가 아직 없습니다.', code: 'NO_TABLE' }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
