import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/production/bokcheung-store';
import { SITE_EDITORS, cleanPartner } from '@/lib/work-order/site-server';

/**
 * 외주 업체 (lib/work-order/site.ts).
 *   GET          → { partners }   쓰는 업체, 이름순 (승인된 사람 누구나 — 공사개발부도 담당자를 본다)
 *   POST {name, contact_name, phone, memo} → 새 업체 (작업의뢰서를 다루는 업무지원부 · 마스터)
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await createServiceRoleClient()
    .from('dgflow_outsource_partners')
    .select('id, name, contact_name, phone, memo, is_active')
    .eq('is_active', true)
    .order('name');
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: '외주 업체 표가 아직 없습니다.', code: 'NO_TABLE' }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ partners: data ?? [] });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasAnyPermission(user, SITE_EDITORS)) {
    return NextResponse.json({ error: '외주 업체를 더할 권한이 없습니다.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const row = cleanPartner(body);
  if (!row.name) return NextResponse.json({ error: '업체명을 입력하세요.' }, { status: 400 });

  const { data, error } = await createServiceRoleClient()
    .from('dgflow_outsource_partners')
    .insert(row)
    .select('id, name, contact_name, phone, memo, is_active')
    .single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: `이미 있는 업체입니다: ${row.name}` }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ partner: data }, { status: 201 });
}
