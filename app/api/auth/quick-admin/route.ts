import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { QUICK_ADMIN_LOGIN_ID, quickAdminLoginEnabled } from '@/lib/auth/quick-login';

/**
 * 관리자 계정으로 바로 로그인.
 *
 * 비밀번호를 쓰지 않는다 — service role 로 그 계정의 일회용 로그인 토큰(magic link 의 hashed_token)을
 * 만들고, 곧바로 서버에서 검증해 세션 쿠키를 심는다. 메일은 보내지 않는다.
 * 꺼져 있으면(운영에서 NEXT_PUBLIC_ADMIN_QUICK_LOGIN 이 on 이 아니면) 없는 주소처럼 404.
 */
export async function POST() {
  if (!quickAdminLoginEnabled()) {
    return NextResponse.json({ error: '관리자 빠른 로그인이 꺼져 있습니다.' }, { status: 404 });
  }

  const admin = createServiceRoleClient();
  const { data: user } = await admin
    .from('dgflow_users')
    .select('email, role, status, is_active')
    .eq('login_id', QUICK_ADMIN_LOGIN_ID)
    .maybeSingle();
  if (!user || user.role !== 'master' || user.status !== 'active' || !user.is_active) {
    return NextResponse.json({ error: '사용할 수 있는 관리자 계정이 없습니다.' }, { status: 404 });
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    return NextResponse.json({ error: '로그인 토큰을 만들지 못했습니다.' }, { status: 500 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
  if (error) return NextResponse.json({ error: '로그인하지 못했습니다.' }, { status: 500 });

  return NextResponse.json({ success: true });
}
