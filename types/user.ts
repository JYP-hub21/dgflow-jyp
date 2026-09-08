export const USER_ROLES = {
  admin: '관리자',
  construction_mgr: '공사관리부',
  biz_support: '경영지원팀',
  production_mgr: '생산관리팀',
  system_admin: '시스템관리자',
} as const;

export type UserRole = keyof typeof USER_ROLES;

export interface DgflowUser {
  id: string;
  auth_id: string;
  email: string;
  name: string;
  role: UserRole;
  department: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
