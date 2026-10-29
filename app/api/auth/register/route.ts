import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission, normalizePermissions } from '@/lib/auth/role-guard';
import { loginIdError, normalizeLoginId, normalizePhone, passwordError } from '@/lib/auth/account';
import { createAccount } from '@/lib/auth/create-account';
import { NextRequest, NextResponse } from 'next/server';

/** 관리자가 사용자를 직접 추가한다 — 가입 신청을 거치지 않고 바로 쓸 수 있는 계정 */
export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser || !hasPermission(currentUser, 'admin:users')) {
    return NextResponse.json({ error: '사용자를 등록할 권한이 없습니다.' }, { status: 403 });
  }

  const body = await request.json();
  const loginId = normalizeLoginId(String(body.loginId ?? ''));
  const err = loginIdError(loginId) ?? passwordError(body.password ?? '')
    ?? (String(body.name ?? '').trim() ? null : '이름을 입력하세요.');
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  let phone: string | null = null;
  if (body.phone) {
    phone = normalizePhone(String(body.phone));
    if (!phone) return NextResponse.json({ error: '전화번호를 확인하세요.' }, { status: 400 });
  }

  if (body.role === 'master' && currentUser.role !== 'master') {
    return NextResponse.json({ error: '마스터 계정은 마스터만 만들 수 있습니다.' }, { status: 403 });
  }
  const granted = normalizePermissions(Array.isArray(body.permissions) ? body.permissions.map(String) : []);
  if (granted.some(k => !hasPermission(currentUser, k))) {
    return NextResponse.json({ error: '자기에게 없는 권한은 줄 수 없습니다.' }, { status: 403 });
  }

  const result = await createAccount({
    loginId,
    password: body.password,
    name: String(body.name).trim(),
    phone,
    birthDate: body.birthDate || null,
    department: body.department?.trim() || null,
    position: body.position?.trim() || null,
    role: body.role === 'master' ? 'master' : 'staff',
    permissions: granted,
    status: 'active',
    approvedBy: currentUser.id,
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ success: true }, { status: 201 });
}
