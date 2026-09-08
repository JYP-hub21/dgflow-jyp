import { getCurrentUser } from '@/lib/auth/get-user';
import { NextResponse } from 'next/server';
import type { DgflowUser, UserRole } from '@/types/user';

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function jsonSuccess(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * 인증 + 선택적 역할 체크
 * 실패 시 에러 응답 반환, 성공 시 user 반환
 */
export async function requireAuth(roles?: UserRole[]): Promise<DgflowUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return jsonError('Unauthorized', 401);
  if (roles && !roles.includes(user.role)) {
    return jsonError('권한이 없습니다.', 403);
  }
  return user;
}

export function isErrorResponse(result: unknown): result is NextResponse {
  return result instanceof NextResponse;
}
