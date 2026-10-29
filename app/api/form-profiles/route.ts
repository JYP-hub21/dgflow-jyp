/**
 * 발주서 양식 프로파일 API
 *
 * 사원이 화면에서 한 번 찍어 준 열 위치를 저장해 두고, 같은 거래처의 다음 발주서에
 * 자동으로 적용한다. 자동 판정이 실패해도 사원이 매번 같은 작업을 반복하지 않게 하는 게 목적이다.
 */
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { NextRequest, NextResponse } from 'next/server';

interface ProfilePayload {
  name: string;
  customer_hint?: string | null;
  site_hint?: string | null;
  header_signature?: string | null;
  header_row?: number | null;
  columns?: Record<string, number | null>;
  location_source?: string | null;
  verified?: boolean;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'erp:generate')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('dgflow_order_form_profiles')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** 같은 이름이면 덮어쓴다 — 사원이 조금씩 고쳐 가며 저장할 수 있어야 한다. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'erp:generate')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const body = (await request.json()) as ProfilePayload;
  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: '양식 이름을 입력하세요.' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('dgflow_order_form_profiles')
    .upsert(
      {
        name,
        customer_hint: body.customer_hint || null,
        site_hint: body.site_hint || null,
        header_signature: body.header_signature || null,
        header_row: body.header_row ?? null,
        columns: body.columns ?? {},
        location_source: body.location_source || null,
        verified_at: body.verified ? new Date().toISOString() : null,
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
  const { error } = await supabase.from('dgflow_order_form_profiles').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
