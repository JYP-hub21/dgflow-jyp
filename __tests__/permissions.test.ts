import { describe, it, expect } from 'vitest';
import {
  ALL_PERMISSIONS, PERMISSION_PRESETS, getMenuFor, hasPermission, homePathFor, normalizePermissions,
} from '@/lib/auth/role-guard';

describe('사원별 기능 권한', () => {
  it('마스터는 권한 목록과 상관없이 전부 통과한다', () => {
    const master = { role: 'master' as const, permissions: [] };
    expect(ALL_PERMISSIONS.every(k => hasPermission(master, k))).toBe(true);
  });

  it('사원은 부여받은 것만 통과한다', () => {
    const staff = { role: 'staff' as const, permissions: ['production:view'] };
    expect(hasPermission(staff, 'production:view')).toBe(true);
    expect(hasPermission(staff, 'production:input')).toBe(false);
    expect(hasPermission({ role: 'staff', permissions: null }, 'production:view')).toBe(false);
  });

  it('메뉴는 권한이 있는 것만 보이고, 첫 화면은 그중 첫 메뉴다', () => {
    const staff = { role: 'staff' as const, permissions: ['production:view'] };
    expect(getMenuFor(staff).map(m => m.href)).toEqual(['/work-orders', '/production', '/production/report']);
    expect(homePathFor(staff)).toBe('/work-orders');
    expect(homePathFor({ role: 'staff', permissions: [] })).toBeNull();
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
