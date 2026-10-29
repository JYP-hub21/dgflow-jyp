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

/**
 * 외부에 노출되는 링크(고객 승인 링크 등)의 기준 주소.
 *
 * VERCEL_URL 은 배포마다 바뀌는 일회성 주소라 사용하지 않는다.
 * 고객에게 보낸 링크가 재배포 후 낡은 배포를 가리키거나,
 * 배포 보호(Deployment Protection)에 걸려 비로그인 접근이 막힐 수 있다.
 *
 * 우선순위: 명시적 설정 > Vercel 운영 도메인 > 로컬
 */
export function getPublicBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return 'http://localhost:3000';
}
