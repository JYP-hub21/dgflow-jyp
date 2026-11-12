import { describe, it, expect } from 'vitest';
import {
  ALL_PERMISSIONS, PERMISSION_PRESETS, WORK_PERMISSIONS, canView, getMenuFor, hasPermission, homePathFor, normalizePermissions,
} from '@/lib/auth/role-guard';

describe('사원별 기능 권한', () => {
  it('마스터는 전부 보고 관리하지만, 부서 업무(확인 · 입력)는 하지 않는다 (2026-11-12)', () => {
    const master = { role: 'master' as const, permissions: [], department: '경영진' };
    expect(ALL_PERMISSIONS.every(k => canView(master, k))).toBe(true);
    expect(hasPermission(master, 'admin:users')).toBe(true);
    expect(hasPermission(master, 'production:view')).toBe(true);
    expect(hasPermission(master, 'production:input')).toBe(false);
    expect(hasPermission(master, 'order:process')).toBe(false);
  });

  it('직원은 모든 탭을 보지만, 일은 자기 부서 것만 한다 (2026-11-12)', () => {
    const who = (department: string) => ({ role: 'staff' as const, permissions: WORK_PERMISSIONS, department });
    expect(getMenuFor(who('공사관리부')).map(m => m.href)).not.toContain('/admin/users');
    expect(getMenuFor(who('생산부')).length).toBe(getMenuFor({ role: 'master' }).length - 2);
    expect(hasPermission(who('공사관리부'), 'order:submit')).toBe(true);
    expect(hasPermission(who('공사관리부'), 'production:input')).toBe(false);
    expect(hasPermission(who('업무지원부'), 'order:process')).toBe(true);
    expect(hasPermission(who('업무지원부'), 'order:submit')).toBe(false);
    expect(hasPermission(who('생산부'), 'production:input')).toBe(true);
    expect(hasPermission(who('생산관리부'), 'production:input')).toBe(true);
    expect(hasPermission(who('생산관리부'), 'work_order:create')).toBe(false);
    expect(hasPermission(who('경영'), 'production:view')).toBe(true);
    expect(hasPermission(who('경영'), 'production:input')).toBe(false);
  });

  it('사원은 부여받은 것만 통과한다', () => {
    const staff = { role: 'staff' as const, permissions: ['production:view'] };
    expect(hasPermission(staff, 'production:view')).toBe(true);
    expect(hasPermission(staff, 'production:input')).toBe(false);
    expect(hasPermission({ role: 'staff', permissions: null }, 'production:view')).toBe(false);
  });

  it('메뉴는 권한이 있는 것만 보이고, 대시보드는 누구나 보며 첫 화면이다 (2026-10-30)', () => {
    const staff = { role: 'staff' as const, permissions: ['production:view'] };
    expect(getMenuFor(staff).map(m => m.href)).toEqual(['/dashboard', '/work-orders', '/production', '/production/report', '/deliveries']);
    expect(homePathFor(staff)).toBe('/dashboard');
    const nobody = { role: 'staff' as const, permissions: [] };
    expect(getMenuFor(nobody).map(m => m.href)).toEqual(['/dashboard']);
    expect(homePathFor(nobody)).toBe('/dashboard');
  });

  it('생산 입력을 주면 생산 조회가 따라온다 — 입력 화면이 조회 화면 안에 있다', () => {
    expect(normalizePermissions(['production:input'])).toEqual(['production:view', 'production:input']);
  });

  it('모르는 키는 저장하지 않고, 순서는 목록 순서로 맞춘다', () => {
    expect(normalizePermissions(['admin:users', 'order:approve', 'erp:generate', 'erp:generate']))
      .toEqual(['erp:generate', 'admin:users']);
  });

  it('권한 묶음은 실제로 있는 권한만 담는다', () => {
    for (const p of PERMISSION_PRESETS) {
      expect(normalizePermissions(p.permissions)).toEqual(expect.arrayContaining(p.permissions));
    }
  });
});
