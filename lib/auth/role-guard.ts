import type { UserRole } from '@/types/user';

// 각 페이지/기능별 접근 가능 역할
const ROLE_PERMISSIONS: Record<string, UserRole[]> = {
  // 주문 관련
  'orders:create': ['construction_mgr', 'system_admin'],
  'orders:edit': ['construction_mgr', 'biz_support', 'system_admin'],
  'orders:view': ['construction_mgr', 'biz_support', 'admin', 'production_mgr', 'system_admin'],

  // 검토
  'review:access': ['biz_support', 'system_admin'],

  // 승인
  'approve:access': ['admin', 'system_admin'],

  // ERP
  'erp:generate': ['biz_support', 'system_admin'],

  // 생산
  'production:input': ['production_mgr', 'system_admin'],
  'production:view': ['construction_mgr', 'biz_support', 'admin', 'production_mgr', 'system_admin'],

  // 대시보드
  'dashboard:access': ['admin', 'biz_support', 'system_admin'],

  // 관리
  'admin:users': ['system_admin'],
  'admin:master': ['system_admin', 'biz_support'],
};

export function hasPermission(role: UserRole, permission: string): boolean {
  const allowedRoles = ROLE_PERMISSIONS[permission];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role);
}

// 사이드바 메뉴 정의
export interface MenuItem {
  label: string;
  href: string;
  icon: string;
  permission: string;
}

export const MENU_ITEMS: MenuItem[] = [
  { label: '대시보드', href: '/dashboard', icon: 'LayoutDashboard', permission: 'dashboard:access' },
  { label: '주문 관리', href: '/orders', icon: 'ClipboardList', permission: 'orders:view' },
  { label: '검토', href: '/review', icon: 'FileCheck', permission: 'review:access' },
  { label: '승인', href: '/approve', icon: 'CheckCircle', permission: 'approve:access' },
  { label: '작업의뢰서', href: '/work-orders', icon: 'FileCheck', permission: 'production:view' },
  { label: '생산 현황', href: '/production', icon: 'Factory', permission: 'production:view' },
  { label: '마스터 관리', href: '/admin/products', icon: 'Database', permission: 'admin:master' },
  { label: '사용자 관리', href: '/admin/users', icon: 'Users', permission: 'admin:users' },
];

export function getMenuForRole(role: UserRole): MenuItem[] {
  return MENU_ITEMS.filter(item => hasPermission(role, item.permission));
}
