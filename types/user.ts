/**
 * 사용자 역할
 *
 * 기존 5개 역할(관리자/공사관리부/경영지원팀/생산관리팀/시스템관리자)은
 * 권한이 코드에 하드코딩되어 운영 중 조정이 불가능했다.
 * 이제 역할은 두 가지만 두고, 세부 기능 권한은 사원별로 부여한다.
 *
 * - master: 모든 기능을 사용할 수 있는 마스터 계정. 사원 권한을 부여/회수한다.
 * - staff:  일반 사원. 마스터가 지정한 기능만 사용한다.
 */
export const USER_ROLES = {
  master: '마스터',
  staff: '사원',
} as const;

export type UserRole = keyof typeof USER_ROLES;

/** pending: 가입 신청 후 관리자 승인 전 — 로그인도 데이터 접근도 안 된다 */
export type UserStatus = 'pending' | 'active';

export interface DgflowUser {
  id: string;
  auth_id: string;
  /** Auth 이메일. 가입한 사원은 {login_id}@dgflow.local */
  email: string;
  /** 로그인에 쓰는 영문 아이디 (소문자) */
  login_id: string;
  name: string;
  phone: string | null;
  birth_date: string | null;
  position: string | null;
  status: UserStatus;
  role: UserRole;
  /** 사원이 부여받은 기능 권한 키 (lib/auth/role-guard.ts). 마스터는 무시한다 */
  permissions: string[];
  department: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
