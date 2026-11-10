/**
 * 생산 인원 명단 API — 주간생산일지 투입 인원 칸에서 고를 사람들.
 * GET: 명단 (표가 없으면 storage 'none') · POST: 명단에 한 사람 더하기 (생산 입력 권한)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { CREW_TABLE, loadCrew } from '@/lib/production/crew';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:view')) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  try {
    return NextResponse.json(await loadCrew(createServiceRoleClient()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '명단을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:input')) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: string; position?: string } | null;
  const name = (body?.name ?? '').trim().slice(0, 40);
  if (!name) return NextResponse.json({ error: '이름을 입력하세요.' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { storage, members } = await loadCrew(supabase);
  if (storage === 'none') return NextResponse.json({ error: '명단 표가 아직 데이터베이스에 없습니다.' }, { status: 503 });
  const same = members.find(m => m.name === name);
  if (same) {
    // 끈 사람이면 다시 켠다
    if (!same.active) await supabase.from(CREW_TABLE).update({ active: true }).eq('id', same.id);
    return NextResponse.json({ data: { ...same, active: true } });
  }
  const { data, error } = await supabase
    .from(CREW_TABLE)
    .insert({
      name, department: '생산부', position: (body?.position ?? '').trim().slice(0, 20),
      sort_order: Math.max(0, ...members.map(m => m.sort_order)) + 1,
    })
    .select('id, name, full_name, department, position, aliases, sort_order, active')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
