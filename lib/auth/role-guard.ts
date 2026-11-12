import type { UserRole } from '@/types/user';
import { DEPARTMENTS, deptOf, type DeptKey } from '@/lib/departments';

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
      { key: 'order:submit', label: '발주서 등록 (담당자 지목)' },
      { key: 'order:process', label: '발주서 처리 (담당 접수 · ERP 변환 · 작업의뢰서 연결)' },
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
  // 대시보드 권한(dashboard:access)은 2026-10-30 에 없앴다 — 대시보드는 승인된 사람 누구나 본다.
  // 예전에 저장된 키는 판정에 쓰이지 않고, 권한을 다시 저장할 때 normalizePermissions 가 걸러 낸다.
  {
    group: '기타',
    items: [
      { key: 'admin:master', label: '마스터 관리 (품명 · 거래처 · 현장 · 원판)' },
      { key: 'admin:users', label: '사용자 · 권한 관리' },
    ],
  },
] as const;

export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap(g =>
  g.items.map(i => i.key),
);

/**
 * 업무 권한 전부 — 관리 권한(마스터 관리 · 사용자 관리)만 뺀 것.
 * 2026-11-12 사용자 결정: "각자 부서 것만 보이게 하는 게 아니라 관리자처럼 모든 탭이 보이게,
 * 마스터 관리랑 사용자 관리만 관리자가 볼 수 있게". 미리 만든 직원 계정 · 가입 승인 · 직접 추가의 기본값이다.
 * 부서 덩어리로 좁혀 주는 것은 사용자 관리에서 여전히 할 수 있다.
 */
export const WORK_PERMISSIONS: string[] = ALL_PERMISSIONS.filter(k => !k.startsWith('admin:'));

/** 권한 키 → 한글 라벨 */
export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap(g => g.items.map(i => [i.key, i.label])),
);

/**
 * 부서 덩어리 권한 — 사이드바 부서 구역의 메뉴가 쓰는 권한 전부.
 * 사용자 관리에서 덩어리째로 주고 빼며, 덩어리를 주면 그 부서 구역만 열린다 (2026-10-30 피드백
 * "권한은 덩어리째로, 각자 자기 탭만"). 전체 현황은 누구나 대시보드에서 본다.
 * 메뉴(MENU_ITEMS)에 부서 메뉴를 더하면 여기 권한도 함께 맞춘다 — 테스트가 어긋남을 잡는다.
 */
export const DEPT_PERMISSIONS: Record<DeptKey, string[]> = {
  construction: ['order:submit'],
  support: ['order:process', 'erp:generate', 'work_order:create'],
  production: ['production:view', 'production:input'],
};

/** 권한 묶음 — 사용자 관리 화면에서 한 번에 주는 조합. 부서 덩어리와 같다 */
export const PERMISSION_PRESETS: { label: string; permissions: string[] }[] =
  DEPARTMENTS.map(d => ({ label: d.name, permissions: DEPT_PERMISSIONS[d.key] }));

/** 권한 목록을 '통째로 가진 부서 덩어리' 와 '덩어리에 안 묶인 나머지' 로 나눈다 — 사용자 목록 요약용 */
export function deptBlocksOf(permissions: readonly string[] | null | undefined): { blocks: DeptKey[]; extras: string[] } {
  const have = new Set(permissions ?? []);
  const blocks = DEPARTMENTS.map(d => d.key).filter(k => DEPT_PERMISSIONS[k].every(p => have.has(p)));
  const covered = new Set(blocks.flatMap(k => DEPT_PERMISSIONS[k]));
  const extras = ALL_PERMISSIONS.filter(p => have.has(p) && !covered.has(p));
  return { blocks, extras };
}

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

/** 판정에 필요한 사용자 정보 — 역할 · 부여받은 권한 목록 · 부서 */
export interface PermissionSubject {
  role: UserRole;
  permissions?: string[] | null;
  /** 사원 정보의 부서 칸 — 업무 권한(PERMISSION_DEPT)은 이 부서가 맞아야 쓴다 */
  department?: string | null;
}

/**
 * 업무 권한마다 그 일을 하는 부서 (2026-11-12 사용자: "생산 거면 생산부서 사람들 아이디에서만 수신 확인을 누를 수
 * 있어야 하고, 이런 건 기본적인 흐름이니 절대 위배하지 마").
 * 직원 모두가 모든 탭을 보지만(WORK_PERMISSIONS), 일은 그 부서 계정만 한다 — 관리자(마스터)도 마찬가지다.
 * 관리자는 사용자 · 마스터 관리와 전체 보기만 한다. 발주서 확인은 여기에 더해 지목된 담당자 본인만 한다.
 */
// ERP 엑셀 생성(DG 프리즘 포함)은 부서와 상관없이 누구나 쓴다 (2026-11-12 사용자 "DG 프리즘은 모든 사람이 다 쓸 수 있게").
// 만든 결과를 발주 건에 저장하는 것은 여전히 order:process + 지목된 담당자 본인만이다.
export const PERMISSION_DEPT: Partial<Record<string, DeptKey>> = {
  'order:submit': 'construction',
  'order:process': 'support',
  'work_order:create': 'support',
  'production:input': 'production',
};

/**
 * 볼 수 있나 — 메뉴 · 화면 문(PermissionGate) · 권한 주고 빼기에 쓴다. 마스터는 전부, 사원은 부여받은 것.
 * DB 의 dgflow_has_permission() 과 같은 규칙이다 — 하나를 바꾸면 둘 다 바꾼다. (DB 는 읽기 · 보기만 막는다)
 */
export function canView(user: PermissionSubject, permission: string): boolean {
  if (user.role === 'master') return true;
  return (user.permissions ?? []).includes(permission);
}

/** 여러 권한 중 하나라도 볼 수 있으면 통과 */
export function canViewAny(user: PermissionSubject, permissions: string | readonly string[]): boolean {
  return (typeof permissions === 'string' ? [permissions] : permissions).some(p => canView(user, p));
}

/**
 * 그 일을 할 수 있나 — 저장 · 확인 · 입력 같은 일을 하는 곳은 모두 이것으로 판정한다.
 * 부서가 정해진 업무 권한은 권한이 있고 그 부서 계정이어야 한다. 나머지(보기 · 관리)는 canView 와 같다.
 */
export function hasPermission(user: PermissionSubject, permission: string): boolean {
  const dept = PERMISSION_DEPT[permission];
  if (!dept) return canView(user, permission);
  return (user.permissions ?? []).includes(permission) && deptOf(user.department) === dept;
}

/** 이 업무를 하는 부서 이름 — "○○ 계정에서 합니다" 안내용 */
export function deptNameFor(permission: string): string | null {
  const dept = PERMISSION_DEPT[permission];
  if (!dept) return null;
  return dept === 'production' ? '생산관리부 · 생산부' : DEPARTMENTS.find(d => d.key === dept)!.name;
}

/** 여러 권한 중 하나라도 있으면 통과 */
export function hasAnyPermission(user: PermissionSubject, permissions: string | readonly string[]): boolean {
  return (typeof permissions === 'string' ? [permissions] : permissions).some(p => hasPermission(user, p));
}

/** 발주서 접수함을 볼 수 있는 권한 — 올리는 사람과 처리하는 사람 */
export const ORDER_ANY = ['order:submit', 'order:process'];

// 사이드바 메뉴 정의

/** 사이드바 구역 — 맨 위 공통, 부서 셋(흐름 순서), 맨 아래 관리 */
export type MenuGroup = 'common' | DeptKey | 'admin';

export interface MenuItem {
  label: string;
  href: string;
  icon: string;
  /** 여럿이면 그중 하나만 있어도 보인다. 없으면 승인된 사람 누구나 (대시보드) */
  permission?: string | string[];
  /** 사이드바에서 묶어 보여 줄 구역 */
  group: MenuGroup;
  /** 대시보드 업무 흐름 칸에 붙는 짧은 설명 */
  hint?: string;
}

/*
  2026-10-30 현장 피드백으로 "업무" 한 덩어리를 부서별로 나눴다.
  발주서 화면 하나를 공사관리부(올리기 · 올린 것)와 업무지원부(받은 것)가 나눠 쓰므로
  메뉴도 보기(view)로 갈라 둔다 — 화면은 그대로 /purchase-orders 다.
*/
export const MENU_ITEMS: MenuItem[] = [
  // 대시보드는 권한 없이 누구나 — 전체 현황은 모두가 보고, 부서 메뉴만 권한대로 열린다
  { label: '대시보드', href: '/dashboard', icon: 'LayoutDashboard', group: 'common' },

  // ① 공사관리부 — 발주서를 올리고, 올린 것이 어디까지 갔는지 본다
  { label: '발주서 등록', href: '/purchase-orders/new', icon: 'Upload', permission: 'order:submit', group: 'construction',
    hint: '파일 업로드 · 담당자 지목' },
  { label: '등록 발주서', href: '/purchase-orders?view=mine', icon: 'Send', permission: 'order:submit', group: 'construction',
    hint: '담당자 확인 여부 · 진행 단계' },

  // ② 업무지원부 — 받은 발주서 → ERP 업로드 엑셀 → (회사 ERP) → 작업의뢰서 등록
  { label: '수신 발주서', href: '/purchase-orders?view=todo', icon: 'Inbox', permission: 'order:process', group: 'support',
    hint: '본인 배정 발주서 확인' },
  { label: 'ERP 업로드', href: '/erp-upload', icon: 'FileSpreadsheet', permission: 'erp:generate', group: 'support',
    hint: 'ERP 업로드용 엑셀 생성' },
  // ERP 가 뽑아 준 작업의뢰서를 받아 오는 입구. 생산 현황은 여기서 시작한다.
  { label: '작업의뢰서 등록', href: '/work-orders/receive', icon: 'ScanLine', permission: 'work_order:create', group: 'support',
    hint: 'ERP 작업의뢰서 엑셀 · PDF 업로드' },

  // ③ 생산관리부 — 작업의뢰서를 보고 생산 수량을 기록한다
  { label: '작업의뢰서', href: '/work-orders', icon: 'FileCheck', permission: 'production:view', group: 'production',
    hint: '접수된 작업의뢰서 조회' },
  { label: '생산 현황', href: '/production', icon: 'Factory', permission: 'production:view', group: 'production',
    hint: '생산 수량 입력 · 진행률' },
  { label: '생산일지', href: '/production/report', icon: 'ClipboardList', permission: 'production:view', group: 'production',
    hint: '날짜별 생산 집계 · 엑셀' },
  // 납품은 생산 · 일지 다음 — 흐름 맨 끝 (2026-11-09 사용자)
  { label: '납품', href: '/deliveries', icon: 'Truck', permission: 'production:view', group: 'production',
    hint: '납품 수량 입력 · 미납 확인' },

  { label: '마스터 관리', href: '/admin/products', icon: 'Database', permission: 'admin:master', group: 'admin' },
  { label: '사용자 관리', href: '/admin/users', icon: 'Users', permission: 'admin:users', group: 'admin' },
];

/** 보이는 메뉴 — 보기 기준(canView). 직원은 모든 업무 탭이 보이고, 관리 두 메뉴는 관리자만 (2026-11-12) */
export function getMenuFor(user: PermissionSubject): MenuItem[] {
  return MENU_ITEMS.filter(item => !item.permission || canViewAny(user, item.permission));
}

/** 로그인 직후 갈 곳 — 쓸 수 있는 첫 메뉴. 대시보드가 누구에게나 열려 있어 늘 대시보드다 */
export function homePathFor(user: PermissionSubject): string | null {
  return getMenuFor(user)[0]?.href ?? null;
}

/** 발주서 목록을 보기 없이 열었을 때의 기본 보기 — 목록 화면(/purchase-orders)과 같은 규칙 */
export function defaultPoView(user: PermissionSubject): 'todo' | 'mine' {
  return hasPermission(user, 'order:process') ? 'todo' : 'mine';
}

/**
 * 지금 화면에 해당하는 메뉴 하나 (없으면 undefined).
 *
 * - 경로가 겹치는 메뉴(`/work-orders` 와 `/work-orders/receive`)는 가장 깊이 맞는 것을 고른다.
 * - 발주서 메뉴는 같은 화면을 보기로 나눠 쓴다. 보기가 없거나 '진행 중 · 전체' 면 목록의 기본 보기를,
 *   발주 건 상세(`/purchase-orders/{id}`)도 기본 보기를 따른다. `/purchase-orders/new` 는 자기 메뉴가 있다.
 */
export function activeMenuHref(
  items: MenuItem[], pathname: string, view: string | null, fallbackView: 'todo' | 'mine',
): string | undefined {
  const poView = view === 'todo' || view === 'mine' ? view : fallbackView;
  const ownMenu = MENU_ITEMS.some(m => m.href === pathname);
  const hits = items.filter(item => {
    const [path, query] = item.href.split('?');
    if (query) {
      const onPage = pathname === path || (pathname.startsWith(`${path}/`) && !ownMenu);
      return onPage && new URLSearchParams(query).get('view') === poView;
    }
    return pathname === path || pathname.startsWith(`${path}/`);
  });
  const depth = (m: MenuItem) => m.href.split('?')[0].length;
  return hits.sort((a, b) => depth(b) - depth(a))[0]?.href;
}

/**
 * 화면 머리글의 부서 이름표용 — 이 화면이 어느 메뉴에 속하는지 분명할 때만 돌려준다.
 * 발주서 목록은 주소에 보기(todo · mine)가 있을 때만 정해지고, 발주 건 상세처럼
 * 두 부서가 함께 쓰는 화면은 없음(undefined).
 */
export function menuForPage(pathname: string, view: string | null): MenuItem | undefined {
  const hits = MENU_ITEMS.filter(item => {
    const [path, query] = item.href.split('?');
    if (query) return pathname === path && new URLSearchParams(query).get('view') === view;
    return pathname === path || pathname.startsWith(`${path}/`);
  });
  const depth = (m: MenuItem) => m.href.split('?')[0].length;
  return hits.sort((a, b) => depth(b) - depth(a))[0];
}
