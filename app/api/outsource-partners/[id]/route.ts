import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { SITE_EDITORS, cleanPartner } from '@/lib/work-order/site-server';

/** PATCH {name?, contact_name?, phone?, memo?, is_active?} — 업체 담당자 · 전화가 바뀌었을 때 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasAnyPermission(user, SITE_EDITORS)) {
    return NextResponse.json({ error: '외주 업체를 고칠 권한이 없습니다.' }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const clean = cleanPartner(body);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ['name', 'contact_name', 'phone', 'memo'] as const) {
    if (key in body) patch[key] = clean[key];
  }
  if ('name' in patch && !patch.name) return NextResponse.json({ error: '업체명을 입력하세요.' }, { status: 400 });
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;

  const { data, error } = await createServiceRoleClient()
    .from('dgflow_outsource_partners')
    .update(patch)
    .eq('id', id)
    .select('id, name, contact_name, phone, memo, is_active')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '같은 이름의 업체가 이미 있습니다.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: '업체를 찾지 못했습니다.' }, { status: 404 });
  return NextResponse.json({ partner: data });
}
