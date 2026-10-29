/**
 * 현장별 포장 규칙 API
 *
 * 사원이 직접 짠 포장 구성을 저장해 같은 현장의 다음 차수 발주서에 재사용한다.
 * 저장하는 것은 행 번호가 아니라 묶은 **기준**이다 (`lib/erp/packaging-rule.ts` 참고).
 */
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { NextRequest, NextResponse } from 'next/server';
import type { PackagingRuleGroup } from '@/lib/erp/packaging-rule';

interface RulePayload {
  name: string;
  site_hint?: string | null;
  customer_hint?: string | null;
  groups: PackagingRuleGroup[];
  reusable?: boolean;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'erp:generate')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('dgflow_site_packaging_rules')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'erp:generate')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const body = (await request.json()) as RulePayload;
  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: '이름을 입력하세요.' }, { status: 400 });
  if (!Array.isArray(body.groups) || body.groups.length === 0) {
    return NextResponse.json({ error: '포장이 하나도 없습니다.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('dgflow_site_packaging_rules')
    .upsert(
      {
        name,
        site_hint: body.site_hint || null,
        customer_hint: body.customer_hint || null,
        groups: body.groups,
        reusable: body.reusable ?? false,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'name' },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'erp:generate')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('dgflow_site_packaging_rules').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
