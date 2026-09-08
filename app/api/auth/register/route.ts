import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser || !['system_admin'].includes(currentUser.role)) {
    return NextResponse.json({ error: '시스템관리자만 사용자를 등록할 수 있습니다.' }, { status: 403 });
  }

  const { email, password, name, role, department } = await request.json();

  if (!email || !password || !name) {
    return NextResponse.json({ error: '이메일, 비밀번호, 이름은 필수입니다.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // 1. Auth 사용자 생성
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  // 2. dgflow_users 등록
  const { error: dbError } = await supabase
    .from('dgflow_users')
    .insert({
      auth_id: authData.user.id,
      email,
      name,
      role: role || 'construction_mgr',
      department: department || null,
    });

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
