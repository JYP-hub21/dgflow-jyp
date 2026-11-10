import { describe, expect, it } from 'vitest';
import { closestPackage, closeness } from '@/app/api/purchase-orders/[id]/direct-link/closest';
import { compareSizes } from '@/lib/purchase-order/match';

/**
 * 발주서를 골라 작업의뢰서를 등록했는데 딱 맞는 포장이 없을 때 (2026-11-10 점검) —
 * 예전에는 '직접 연결' 로 대조 없이 붙었다. 이제 가장 가까운 ERP 포장에 붙여 다른 곳을 보인다.
 */
const r = (width_mm: number, height_mm: number, quantity: number) => ({ width_mm, height_mm, quantity });

const P1 = { label: '1포장', rows: [r(1000, 2000, 4), r(800, 1200, 6), r(600, 900, 2)] };
const P2 = { label: '2포장', rows: [r(1500, 1500, 10), r(700, 700, 3)] };
const P3 = { label: '3포장', rows: [r(1000, 2000, 4), r(900, 900, 8)] };

describe('가장 가까운 ERP 포장 고르기', () => {
  it('오타 하나 — 나머지 규격이 같은 포장을 고른다', () => {
    // 1포장의 800×1200 6조를 5조로 잘못 넣은 작업의뢰서
    const wo = [r(1000, 2000, 4), r(800, 1200, 5), r(600, 900, 2)];
    expect(compareSizes(P1.rows, wo).ok).toBe(false);
    expect(closestPackage([P2, P3, P1], wo)?.label).toBe('1포장');
  });

  it('복층 — 같은 규격이 품명 블록마다 되풀이돼도(배수) 맞춰 본다', () => {
    // 1포장 × 2 블록인데 한 줄이 틀림
    const wo = [r(1000, 2000, 8), r(800, 1200, 12), r(600, 900, 3)];
    expect(closeness(P1.rows, wo).lines).toBe(2);
    expect(closestPackage([P3, P1, P2], wo)?.label).toBe('1포장');
  });

  it('맞는 규격 수가 같으면 합계 수량이 가까운 쪽', () => {
    // 1포장 · 3포장 모두 1000×2000 4조 한 가지만 맞고 합계도 둘 다 12조 (작업의뢰서 13조) → 같으면 먼저 온 것
    const wo = [r(1000, 2000, 4), r(500, 500, 9)];
    expect(closestPackage([P3, P1], wo)?.label).toBe('3포장');
    expect(closestPackage([P1, P3], wo)?.label).toBe('1포장');
    // 합계가 다르면 가까운 쪽
    const P4 = { label: '4포장', rows: [r(1000, 2000, 4), r(500, 500, 30)] };
    expect(closestPackage([P4, P3], [r(1000, 2000, 4), r(500, 500, 7)])?.label).toBe('3포장');
  });

  it('규격이 하나도 겹치지 않으면 null — 엉뚱한 포장에 붙이지 않고 직접 연결로 보낸다', () => {
    const pkgs = [{ id: 'a', rows: [{ width_mm: 500, height_mm: 600, quantity: 2 }] }];
    expect(closestPackage(pkgs, [{ width_mm: 900, height_mm: 1000, quantity: 2 }])).toBeNull();
    // 수량만 다른 규격(오타)은 겹친 것으로 본다
    expect(closestPackage(pkgs, [{ width_mm: 500, height_mm: 600, quantity: 3 }])?.id).toBe('a');
  });

  it('포장이 없으면 null', () => {
    expect(closestPackage([], [r(1, 1, 1)])).toBeNull();
  });
});
