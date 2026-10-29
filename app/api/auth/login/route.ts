import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { normalizeLoginId, toAuthPassword } from '@/lib/auth/account';
import { NextRequest, NextResponse } from 'next/server';

const WRONG = '아이디 또는 비밀번호가 올바르지 않습니다.';

/**
 * 아이디 + 비밀번호 로그인.
 *
 * 아이디로 Auth 이메일을 찾아 서버에서 로그인하고 세션 쿠키를 심는다.
 * 승인 대기 · 사용 중지 계정은 비밀번호가 맞아도 세션을 지우고 이유를 알려 준다.
 * (비밀번호를 확인한 뒤에만 알려 줘서, 남의 아이디가 승인 대기인지 떠볼 수 없다)
 */
export async function POST(request: NextRequest) {
  const { loginId, password } = await request.json().catch(() => ({}));
  if (!loginId || !password) return NextResponse.json({ error: WRONG }, { status: 401 });

  const id = normalizeLoginId(String(loginId));
  const admin = createServiceRoleClient();
  // 예전처럼 이메일로 쳐도 들어오게 한다
  const { data: user } = await admin
    .from('dgflow_users')
    .select('email, status, is_active')
    .eq(id.includes('@') ? 'email' : 'login_id', id)
    .maybeSingle();
  if (!user) return NextResponse.json({ error: WRONG }, { status: 401 });

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: toAuthPassword(String(password)),
  });
  if (error) return NextResponse.json({ error: WRONG }, { status: 401 });

  if (user.status !== 'active' || !user.is_active) {
    await supabase.auth.signOut();
    const message = user.status === 'pending'
      ? '가입 승인을 기다리는 중입니다. 관리자가 승인하면 로그인할 수 있습니다.'
      : '사용이 중지된 계정입니다. 관리자에게 문의하세요.';
    return NextResponse.json({ error: message }, { status: 403 });
  }

  return NextResponse.json({ success: true });
}
