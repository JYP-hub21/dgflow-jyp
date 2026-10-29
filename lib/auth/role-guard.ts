import type { UserRole } from '@/types/user';

/**
 * 기능 권한 정의
 *
 * 화면/API에서 필요한 권한을 여기 한 곳에 모아 둔다.
 * 마스터 계정은 전부 통과하고, 사원은 마스터가 지정한 권한만 통과한다.
 * (사원별 권한 지정 UI는 이 목록을 그대로 체크박스로 렌더링한다)
 */
export const PERMISSION_GROUPS = [
  {
    group: '발주서',
    items: [
      { key: 'order:submit', label: '발주서 올리기 (담당자 지목)' },
      { key: 'order:process', label: '발주서 처리 (담당자로 받기 · ERP 변환 · 작업의뢰서 연결)' },
    ],
  },
  {
    group: '생산',
    items: [
      { key: 'erp:generate', label: 'ERP 엑셀 생성' },
      { key: 'work_order:create', label: '작업의뢰서 등록' },
      { key: 'production:view', label: '작업의뢰서 · 생산 현황 조회' },
      { key: 'production:input', label: '생산 · 재단 실적 입력' },
    ],
  },
  {
    group: '기타',
    items: [
      { key: 'dashboard:access', label: '대시보드' },
      { key: 'admin:master', label: '마스터 관리 (품명 · 거래처 · 현장 · 원판)' },
      { key: 'admin:users', label: '사용자 · 권한 관리' },
    ],
  },
] as const;

export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap(g =>
  g.items.map(i => i.key),
);

/** 권한 키 → 한글 라벨 */
export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap(g => g.items.map(i => [i.key, i.label])),
);

/**
 * 권한 묶음 — 사용자 관리 화면에서 한 번에 체크하는 자주 쓰는 조합.
 * 고른 뒤 낱개로 더하거나 뺄 수 있다.
 */
export const PERMISSION_PRESETS: { label: string; permissions: string[] }[] = [
  { label: '발주서 처리', permissions: ['dashboard:access', 'order:submit', 'order:process', 'erp:generate', 'work_order:create', 'production:view'] },
  { label: '발주서 등록', permissions: ['dashboard:access', 'order:submit', 'production:view'] },
  { label: '현장', permissions: ['dashboard:access', 'production:view', 'production:input'] },
];

/**
 * 함께 있어야 하는 권한. 생산 입력 화면(/production/[id])은 생산 현황(/production) 안에 있어
 * 조회 권한 없이 입력만 주면 화면에 들어가지 못한다.
 */
const PERMISSION_REQUIRES: Record<string, string[]> = {
  'production:input': ['production:view'],
};

/** 모르는 키는 버리고, 함께 있어야 하는 권한은 채운다. 저장 직전에 한 번 거친다 */
export function normalizePermissions(keys: string[]): string[] {
  const set = new Set(keys.filter(k => ALL_PERMISSIONS.includes(k)));
  for (const k of [...set]) for (const r of PERMISSION_REQUIRES[k] ?? []) set.add(r);
  return ALL_PERMISSIONS.filter(k => set.has(k));
}

/** 판정에 필요한 사용자 정보 — 역할과 부여받은 권한 목록 */
export interface PermissionSubject {
  role: UserRole;
  permissions?: string[] | null;
}

/**
 * 마스터는 전부, 사원은 부여받은 것만.
 * DB 의 dgflow_has_permission() 과 같은 규칙이다 — 하나를 바꾸면 둘 다 바꾼다.
 */
export function hasPermission(user: PermissionSubject, permission: string): boolean {
  if (user.role === 'master') return true;
  return (user.permissions ?? []).includes(permission);
}

/** 여러 권한 중 하나라도 있으면 통과 */
export function hasAnyPermission(user: PermissionSubject, permissions: string | readonly string[]): boolean {
  return (typeof permissions === 'string' ? [permissions] : permissions).some(p => hasPermission(user, p));
}

/** 발주서 접수함을 볼 수 있는 권한 — 올리는 사람과 처리하는 사람 */
export const ORDER_ANY = ['order:submit', 'order:process'];

// 사이드바 메뉴 정의
export interface MenuItem {
  label: string;
  href: string;
  icon: string;
  /** 여럿이면 그중 하나만 있어도 보인다 */
  permission: string | string[];
  /** 사이드바에서 묶어 보여 줄 구역 */
  section: 'work' | 'admin';
}

export const MENU_ITEMS: MenuItem[] = [
  { label: '대시보드', href: '/dashboard', icon: 'LayoutDashboard', permission: 'dashboard:access', section: 'work' },
  // 실제 업무 순서대로 — 발주서 → ERP 업로드 엑셀 → (회사 ERP) → 작업의뢰서 → 생산
  // 발주서 접수함이 파이프라인의 출발점이다. 올린 사람도, 처리하는 사람도 여기서 본다.
  { label: '발주서', href: '/purchase-orders', icon: 'Inbox', permission: ORDER_ANY, section: 'work' },
  { label: 'ERP 업로드', href: '/erp-upload', icon: 'FileSpreadsheet', permission: 'erp:generate', section: 'work' },
  // ERP 가 뽑아 준 작업의뢰서를 받아 오는 입구. 생산 현황은 여기서 시작한다.
  { label: '작업의뢰서 등록', href: '/work-orders/receive', icon: 'ScanLine', permission: 'work_order:create', section: 'work' },
  { label: '작업의뢰서', href: '/work-orders', icon: 'FileCheck', permission: 'production:view', section: 'work' },
  { label: '생산 현황', href: '/production', icon: 'Factory', permission: 'production:view', section: 'work' },
  { label: '생산일지', href: '/production/report', icon: 'ClipboardList', permission: 'production:view', section: 'work' },
  { label: '마스터 관리', href: '/admin/products', icon: 'Database', permission: 'admin:master', section: 'admin' },
  { label: '사용자 관리', href: '/admin/users', icon: 'Users', permission: 'admin:users', section: 'admin' },
];

export function getMenuFor(user: PermissionSubject): MenuItem[] {
  return MENU_ITEMS.filter(item => hasAnyPermission(user, item.permission));
}

/** 로그인 직후 갈 곳 — 쓸 수 있는 첫 메뉴. 권한이 하나도 없으면 null */
export function homePathFor(user: PermissionSubject): string | null {
  return getMenuFor(user)[0]?.href ?? null;
}
