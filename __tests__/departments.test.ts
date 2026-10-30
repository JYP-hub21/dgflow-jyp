import { describe, it, expect } from 'vitest';
import { DEPARTMENTS, deptOf } from '@/lib/departments';
import {
  DEPT_PERMISSIONS, MENU_ITEMS, PERMISSION_PRESETS, activeMenuHref, defaultPoView, deptBlocksOf,
  getMenuFor, hasAnyPermission, menuForPage, normalizePermissions,
} from '@/lib/auth/role-guard';
import { quickAdminLoginEnabled } from '@/lib/auth/quick-login';

const master = { role: 'master' as const, permissions: [] };
const preset = (label: string) => ({
  role: 'staff' as const,
  permissions: PERMISSION_PRESETS.find(p => p.label === label)!.permissions,
});

describe('부서별 사이드바 (2026-10-30 현장 피드백)', () => {
  it('발주서는 공사개발부 → 업무지원부 → 생산관리부 순서로 흐른다', () => {
    expect(DEPARTMENTS.map(d => [d.order, d.name])).toEqual([[1, '공사개발부'], [2, '업무지원부'], [3, '생산관리부']]);
  });

  it('사원 정보의 부서 칸은 핵심 낱말로 읽는다', () => {
    expect(deptOf('공사개발부')).toBe('construction');
    expect(deptOf('공사부')).toBe('construction');
    expect(deptOf(' 업무지원팀 ')).toBe('support');
    expect(deptOf('생산관리부')).toBe('production');
    expect(deptOf('생산팀')).toBe('production');
    expect(deptOf('경영관리')).toBeNull();
    expect(deptOf(null)).toBeNull();
    expect(deptOf('')).toBeNull();
  });

  it('부서 묶음을 주면 그 부서 구역의 메뉴가 전부 열린다', () => {
    for (const d of DEPARTMENTS) {
      const own = MENU_ITEMS.filter(m => m.group === d.key).map(m => m.href);
      const shown = getMenuFor(preset(d.name)).map(m => m.href);
      expect(shown).toEqual(expect.arrayContaining(own));
    }
  });

  it('부서 덩어리를 주면 자기 구역 메뉴만 열린다 — 다른 부서 탭은 안 보인다', () => {
    for (const d of DEPARTMENTS) {
      const groups = new Set(getMenuFor(preset(d.name)).map(m => m.group));
      expect([...groups].sort()).toEqual(['common', d.key].sort());
    }
  });

  it('덩어리 권한은 그 구역 메뉴가 쓰는 권한을 빠짐없이 담고, 함께 있어야 하는 권한도 갖췄다', () => {
    for (const d of DEPARTMENTS) {
      const block = { role: 'staff' as const, permissions: DEPT_PERMISSIONS[d.key] };
      for (const m of MENU_ITEMS.filter(i => i.group === d.key)) {
        expect(hasAnyPermission(block, m.permission!)).toBe(true);
      }
      expect(new Set(normalizePermissions(DEPT_PERMISSIONS[d.key]))).toEqual(new Set(DEPT_PERMISSIONS[d.key]));
    }
  });

  it('사용자 목록 요약 — 통째로 가진 덩어리와 나머지', () => {
    expect(deptBlocksOf([...DEPT_PERMISSIONS.support, 'admin:users'])).toEqual({ blocks: ['support'], extras: ['admin:users'] });
    // 생산 조회만 있으면 덩어리가 아니다
    expect(deptBlocksOf(['production:view'])).toEqual({ blocks: [], extras: ['production:view'] });
    expect(deptBlocksOf(null)).toEqual({ blocks: [], extras: [] });
  });

  it('발주서 목록 기본 보기 — 처리 권한이 있으면 받은 발주서, 없으면 올린 발주서', () => {
    expect(defaultPoView(master)).toBe('todo');
    expect(defaultPoView({ role: 'staff', permissions: ['order:submit'] })).toBe('mine');
  });
});

describe('지금 화면에 켜지는 메뉴', () => {
  const all = getMenuFor(master);
  const on = (path: string, view: string | null = null, fallback: 'todo' | 'mine' = 'todo') =>
    activeMenuHref(all, path, view, fallback);

  it('경로가 겹치면 가장 깊이 맞는 메뉴 하나', () => {
    expect(on('/work-orders')).toBe('/work-orders');
    expect(on('/work-orders/receive')).toBe('/work-orders/receive');
    expect(on('/work-orders/abc')).toBe('/work-orders');
    expect(on('/production/report')).toBe('/production/report');
    expect(on('/production/abc')).toBe('/production');
  });

  it('발주서 목록은 보기로 나뉜다', () => {
    expect(on('/purchase-orders', 'todo')).toBe('/purchase-orders?view=todo');
    expect(on('/purchase-orders', 'mine')).toBe('/purchase-orders?view=mine');
    // 보기가 없거나 진행 중 · 전체면 목록의 기본 보기
    expect(on('/purchase-orders', null, 'mine')).toBe('/purchase-orders?view=mine');
    expect(on('/purchase-orders', 'all', 'todo')).toBe('/purchase-orders?view=todo');
  });

  it('발주서 올리기는 자기 메뉴, 발주 건 상세는 기본 보기', () => {
    expect(on('/purchase-orders/new')).toBe('/purchase-orders/new');
    expect(on('/purchase-orders/1234', null, 'mine')).toBe('/purchase-orders?view=mine');
  });

  it('메뉴에 없는 화면은 아무것도 안 켠다', () => {
    expect(on('/cutting/abc')).toBeUndefined();
  });
});

describe('관리자 빠른 로그인 — 운영에서는 켜 둘 때만', () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { node: env.NODE_ENV, flag: env.NEXT_PUBLIC_ADMIN_QUICK_LOGIN };
  const run = (node: string, flag?: string) => {
    env.NODE_ENV = node;
    if (flag === undefined) delete env.NEXT_PUBLIC_ADMIN_QUICK_LOGIN; else env.NEXT_PUBLIC_ADMIN_QUICK_LOGIN = flag;
    const on = quickAdminLoginEnabled();
    env.NODE_ENV = saved.node;
    if (saved.flag === undefined) delete env.NEXT_PUBLIC_ADMIN_QUICK_LOGIN; else env.NEXT_PUBLIC_ADMIN_QUICK_LOGIN = saved.flag;
    return on;
  };

  it('개발 서버에서는 켜지고, 운영은 기본으로 꺼져 있다', () => {
    expect(run('development')).toBe(true);
    expect(run('production')).toBe(false);
    expect(run('production', 'off')).toBe(false);
    expect(run('production', 'on')).toBe(true);
  });
});

describe('화면 머리글 부서 이름표', () => {
  const group = (path: string, view: string | null = null) => menuForPage(path, view)?.group;

  it('화면이 속한 부서', () => {
    expect(group('/purchase-orders/new')).toBe('construction');
    expect(group('/purchase-orders', 'mine')).toBe('construction');
    expect(group('/purchase-orders', 'todo')).toBe('support');
    expect(group('/erp-upload')).toBe('support');
    expect(group('/work-orders/receive')).toBe('support');
    expect(group('/work-orders/abc')).toBe('production');
    expect(group('/production/abc')).toBe('production');
  });

  it('두 부서가 함께 쓰는 화면은 이름표가 없다', () => {
    expect(group('/purchase-orders')).toBeUndefined();
    expect(group('/purchase-orders', 'open')).toBeUndefined();
    expect(group('/purchase-orders/1234')).toBeUndefined();
  });
});
