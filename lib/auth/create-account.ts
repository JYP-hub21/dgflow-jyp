import { createServiceRoleClient } from '@/lib/supabase/server';
import { loginIdToEmail, toAuthPassword } from '@/lib/auth/account';
import type { UserRole, UserStatus } from '@/types/user';

/** 사용자 관리 화면이 받는 열 */
export const USER_COLUMNS =
  'id, login_id, email, name, phone, birth_date, department, position, role, permissions, status, is_active, created_at, approved_at';

/**
 * Auth 사용자 + dgflow_users 행을 함께 만든다.
 * 회원가입(승인 대기)과 관리자의 직접 추가(바로 사용)가 같은 길을 쓴다.
 */
export async function createAccount(input: {
  loginId: string;
  password: string;
  name: string;
  phone?: string | null;
  birthDate?: string | null;
  department?: string | null;
  position?: string | null;
  role?: UserRole;
  permissions?: string[];
  status: UserStatus;
  approvedBy?: string | null;
}): Promise<{ error: string; status: number } | { id: string }> {
  const supabase = createServiceRoleClient();

  const { data: taken } = await supabase
    .from('dgflow_users').select('id').eq('login_id', input.loginId).maybeSingle();
  if (taken) return { error: '이미 쓰고 있는 아이디입니다. 다른 아이디를 고르세요.', status: 409 };

  const email = loginIdToEmail(input.loginId);
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: toAuthPassword(input.password),
    email_confirm: true,
  });
  if (authError) {
    const dup = /already|exists|registered/i.test(authError.message);
    return dup
      ? { error: '이미 쓰고 있는 아이디입니다. 다른 아이디를 고르세요.', status: 409 }
      : { error: authError.message, status: 400 };
  }

  const { data, error } = await supabase
    .from('dgflow_users')
    .insert({
      auth_id: authData.user.id,
      email,
      login_id: input.loginId,
      name: input.name,
      phone: input.phone || null,
      birth_date: input.birthDate || null,
      department: input.department || null,
      position: input.position || null,
      role: input.role ?? 'staff',
      permissions: input.permissions ?? [],
      status: input.status,
      approved_by: input.status === 'active' ? input.approvedBy ?? null : null,
      approved_at: input.status === 'active' ? new Date().toISOString() : null,
    })
    .select('id')
    .single();

  if (error) {
    // 사용자 행을 못 만들었으면 Auth 쪽도 지워 아이디가 묶이지 않게 한다
    await supabase.auth.admin.deleteUser(authData.user.id);
    return { error: error.message, status: 500 };
  }
  return { id: data.id };
}
