import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { loginIdToEmail, toAuthPassword, validateAccountChange } from '@/lib/auth/account';
import { loginIdLocked } from '@/lib/auth/quick-login';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const TAKEN = '이미 사용 중인 아이디입니다. 다른 아이디를 입력하세요.';

/**
 * 본인 아이디/비밀번호 변경 (2026-11-02) — 사이드바 아래 '아이디/비밀번호 변경' 창.
 * 계정은 회사가 미리 만들어 나눠 주고, 받은 사람이 여기서 자기 것으로 바꾼다.
 *
 * 무엇을 바꾸든 현재 비밀번호로 본인 확인을 먼저 한다.
 * 아이디를 바꾸면 Auth 이메일({아이디}@dgflow.local)도 함께 바꿔야 로그인(아이디 → 이메일)이 맞는다.
 */
export async function PATCH(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return bad('Unauthorized', 401);

  const body = await request.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword ?? '');
  const checked = validateAccountChange(me.login_id, {
    loginId: String(body.loginId ?? me.login_id),
    newPassword: String(body.newPassword ?? ''),
    currentPassword,
  });
  if ('error' in checked) return bad(checked.error);
  const { loginId, password } = checked.value;
  if (loginId && loginIdLocked(me.login_id)) {
    return bad('관리자 빠른 로그인에 연결된 계정이라 공식 시작 전까지 아이디를 변경할 수 없습니다.');
  }

  // 본인 확인 — 세션 쿠키를 건드리지 않는 일회용 클라이언트로 현재 비밀번호를 확인한다
  const probe = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: wrong } = await probe.auth.signInWithPassword({ email: me.email, password: toAuthPassword(currentPassword) });
  if (wrong) return bad('현재 비밀번호가 올바르지 않습니다.');

  const admin = createServiceRoleClient();
  if (loginId) {
    const { data: taken } = await admin
      .from('dgflow_users').select('id').eq('login_id', loginId).neq('id', me.id).maybeSingle();
    if (taken) return bad(TAKEN, 409);
  }

  const { error: authError } = await admin.auth.admin.updateUserById(me.auth_id, {
    ...(loginId ? { email: loginIdToEmail(loginId), email_confirm: true } : {}),
    ...(password ? { password: toAuthPassword(password) } : {}),
  });
  if (authError) {
    return /already|exists|registered/i.test(authError.message) ? bad(TAKEN, 409) : bad(authError.message, 500);
  }

  if (loginId) {
    const { error } = await admin
      .from('dgflow_users')
      .update({ login_id: loginId, email: loginIdToEmail(loginId), updated_at: new Date().toISOString() })
      .eq('id', me.id);
    if (error) {
      // 사용자 행을 못 바꿨으면 Auth 쪽을 되돌려 아이디와 로그인 이메일이 어긋나지 않게 한다
      await admin.auth.admin.updateUserById(me.auth_id, {
        email: me.email, email_confirm: true,
        ...(password ? { password: toAuthPassword(currentPassword) } : {}),
      });
      return bad(error.message, 500);
    }
  }

  // 아이디 · 비밀번호를 바꾸면 Auth 가 지금 세션을 끊는다 — 새 정보로 다시 로그인해 쿠키를 갈아 끼워 쓰던 화면을 이어 간다
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signInWithPassword({
    email: loginId ? loginIdToEmail(loginId) : me.email,
    password: toAuthPassword(password ?? currentPassword),
  });

  return NextResponse.json({ loginId: loginId ?? me.login_id, idChanged: !!loginId, passwordChanged: !!password });
}
