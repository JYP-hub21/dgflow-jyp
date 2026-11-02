import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { deptOf } from '@/lib/departments';
import { CONTACT_EDITORS } from '@/lib/work-order/site-server';
import { isMissingTable } from '@/lib/production/bokcheung-store';

/**
 * 현장별 공사 담당자 (lib/production/contacts.ts, 마이그레이션 022).
 *   GET                         → { candidates }  고를 수 있는 사람 — 공사개발부 먼저
 *   PUT {site_label, user_id}   → 그 현장의 담당자 정하기 (user_id 가 null 이면 지우기)
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await createServiceRoleClient()
    .from('dgflow_users')
    .select('id, name, department, phone')
    .eq('status', 'active')
    .eq('is_active', true)
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rank = (d: string | null) => (deptOf(d) === 'construction' ? 0 : 1);
  const candidates = (data ?? []).sort((a, b) => rank(a.department) - rank(b.department) || String(a.name).localeCompare(String(b.name), 'ko'));
  return NextResponse.json({ candidates });
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasAnyPermission(user, CONTACT_EDITORS)) {
    return NextResponse.json({ error: '현장 담당자를 정할 권한이 없습니다.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const siteLabel = typeof body.site_label === 'string' ? body.site_label.trim().slice(0, 200) : '';
  const userId = typeof body.user_id === 'string' ? body.user_id : null;
  if (!siteLabel) return NextResponse.json({ error: '현장명이 없습니다.' }, { status: 400 });

  const supabase = createServiceRoleClient();
  if (!userId) {
    const { error } = await supabase.from('dgflow_site_contacts').delete().eq('site_label', siteLabel);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const { data: target } = await supabase.from('dgflow_users').select('id').eq('id', userId).eq('is_active', true).maybeSingle();
  if (!target) return NextResponse.json({ error: '담당자를 찾지 못했습니다.' }, { status: 400 });

  const { error } = await supabase.from('dgflow_site_contacts').upsert(
    { site_label: siteLabel, user_id: userId, updated_by: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'site_label' },
  );
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: '현장 담당자 표가 아직 없습니다.', code: 'NO_TABLE' }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
