import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { QUICK_ADMIN_LOGIN_ID } from '@/lib/auth/quick-login';

/**
 * 로그인 화면 '내 아이디 찾기' — 이름 일부로 직원을 찾아 아이디를 알려 준다 (2026-11-12 사용자 요청).
 * 회사가 직원 계정을 미리 만들어 나눠 주는 방식이라, 처음 쓰는 사람이 자기 아이디를 몰라도 들어오게 한다.
 *
 *   GET ?q=김정  → { people: [{ name, department, position, login_id }] }
 *
 * 로그인 전에 부르는 곳이라 이름 · 부서 · 직급 · 아이디만 돌려준다 (전화번호 · 생년월일은 주지 않는다).
 * 사용 중인 계정만 — 승인 대기 · 사용 중지 계정과 공용 관리자 계정(admin)은 나오지 않는다.
 * 교수님 · 팀원 · 대표이사 · 이사의 개인 관리자 계정은 나온다 (2026-11-12 사용자).
 */
const LIMIT = 8;

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 30);
  if (!q) return NextResponse.json({ people: [] });

  // ilike 의 % _ 는 글자 그대로 찾는다
  const pattern = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
  const { data, error } = await createServiceRoleClient()
    .from('dgflow_users')
    .select('name, department, position, login_id')
    .eq('status', 'active')
    .eq('is_active', true)
    .neq('login_id', QUICK_ADMIN_LOGIN_ID)
    .ilike('name', pattern)
    .order('name')
    .limit(LIMIT);
  if (error) return NextResponse.json({ error: '찾지 못했습니다. 잠시 후 다시 시도하세요.' }, { status: 500 });
  return NextResponse.json({ people: data ?? [] });
}
