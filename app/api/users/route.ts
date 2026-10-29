import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { USER_COLUMNS } from '@/lib/auth/create-account';
import { NextResponse } from 'next/server';

/** 사용자 목록. 사용자 표는 브라우저에서 고칠 수 없어(RLS) 관리 화면은 이 API 를 쓴다 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'admin:users')) {
    return NextResponse.json({ error: '사용자를 관리할 권한이 없습니다.' }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('dgflow_users')
    .select(USER_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 화면이 "역할 바꾸기 · 내 계정" 을 가리려면 내가 누구인지 알아야 한다
  return NextResponse.json({ data, me: { id: user.id, role: user.role, permissions: user.permissions } });
}
