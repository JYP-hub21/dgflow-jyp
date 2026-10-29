import { validateSignup } from '@/lib/auth/account';
import { createAccount } from '@/lib/auth/create-account';
import { NextRequest, NextResponse } from 'next/server';

/**
 * 회원가입 신청 (로그인 없이 부른다).
 * 계정은 승인 대기로 만들어진다 — 관리자가 사용자 관리에서 승인해야 로그인된다.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const checked = validateSignup(body);
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  const v = checked.value;
  const result = await createAccount({
    loginId: v.loginId,
    password: v.password,
    name: v.name,
    phone: v.phone,
    birthDate: v.birthDate,
    department: v.department,
    position: v.position,
    status: 'pending',
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ success: true }, { status: 201 });
}
