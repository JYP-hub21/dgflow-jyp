import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { contactsForWorkOrders } from '@/lib/production/contacts';

/** GET /api/work-orders/{id}/contact — 이 작업의뢰서의 현장 담당자(발주 건을 올린 공사개발부 담당). 없으면 contact: null */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:view')) {
    return NextResponse.json({ error: '생산 현황을 볼 권한이 없습니다.' }, { status: 403 });
  }
  const { id } = await params;
  const contacts = await contactsForWorkOrders(createServiceRoleClient(), [id]);
  return NextResponse.json({ contact: contacts.get(id) ?? null });
}
