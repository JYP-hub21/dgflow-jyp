import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { SITE_EDITORS, validateSite } from '@/lib/work-order/site-server';

/**
 * PATCH {production_site: 'ochang' | 'outsource', outsource_partner_id}
 * 작업의뢰서를 오창공장에서 만들지, 어느 업체에 외주를 줄지 (lib/work-order/site.ts). 업무지원부 · 마스터.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasAnyPermission(user, SITE_EDITORS)) {
    return NextResponse.json({ error: '생산 공장을 바꿀 권한이 없습니다.' }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const supabase = createServiceRoleClient();
  const check = await validateSite(supabase, body);
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: 400 });

  const { error } = await supabase
    .from('dgflow_work_orders')
    .update({ production_site: check.production_site, outsource_partner_id: check.outsource_partner_id })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
