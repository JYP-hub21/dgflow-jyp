import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { listPurchaseOrders } from '@/lib/purchase-order/server';

/**
 * GET → { options }  작업의뢰서 등록의 "어느 발주서에서 나온 건가요?" 에 띄울 발주 건 — 진행 중인 것(취소 · 완료 빼고), 최근 것부터.
 * 현장명이 닮은 것을 위로 올리는 일은 화면이 한다 (입력한 현장명을 알기 때문).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasAnyPermission(user, ['work_order:create', 'order:process'])) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }
  const pos = await listPurchaseOrders(createServiceRoleClient(), { limit: 300 });
  const options = pos
    .filter(p => p.derived !== 'cancelled' && p.derived !== 'done')
    .map(p => ({
      id: p.id, intake_number: p.intake_number, site_name: p.site_name, customer_name: p.customer_name,
      creator_name: p.creator_name, created_at: p.created_at, packages_total: p.packages_total, packages_linked: p.packages_linked,
    }));
  return NextResponse.json({ options });
}
