import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { menuBadges } from '@/lib/notifications';

/**
 * GET /api/notifications — 메뉴 옆 숫자를 다시 센다 (화면을 띄워 둔 채 1분마다).
 * 2026-11-13 회의: 화면을 켜 둔 채 일하다가 새 작업의뢰서가 와도 바로 알아야 한다.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const badges = await menuBadges(createServiceRoleClient(), user);
  return NextResponse.json({ badges }, { headers: { 'Cache-Control': 'no-store' } });
}
