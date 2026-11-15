import { describe, expect, it } from 'vitest';
import { daysBetween, itemStockLots, summarizeLots, STOCK_GRACE_DAYS } from '@/lib/production/stock';

describe('생산 후 미납품 재고 (2026-11-13 회의)', () => {
  const logs = [
    { date: '2026-10-01', qty: 10 },
    { date: '2026-10-20', qty: 10 },
    { date: '2026-11-10', qty: 5 },
  ];

  it('먼저 만든 것부터 나갔다고 보고, 남은 것은 늦게 만든 것들이다', () => {
    // 25 생산 · 12 납품 → 13 남음: 11/10 의 5 + 10/20 의 8
    expect(itemStockLots({ quantity: 30, produced_quantity: 25 }, logs, 12)).toEqual([
      { date: '2026-10-20', qty: 8 }, { date: '2026-11-10', qty: 5 },
    ]);
  });

  it('다 나갔으면 재고가 없다 — 의뢰보다 더 나간 것도', () => {
    expect(itemStockLots({ quantity: 25, produced_quantity: 25 }, logs, 25)).toEqual([]);
    expect(itemStockLots({ quantity: 25, produced_quantity: 25 }, logs, 40)).toEqual([]);
  });

  it('생산 기록 없이 수량만 있으면(지난 의뢰서 가져오기) 생산일을 모른다', () => {
    expect(itemStockLots({ quantity: 10, produced_quantity: 6 }, [], 1)).toEqual([{ date: null, qty: 5 }]);
    expect(itemStockLots({ quantity: 10, produced_quantity: 8 }, [{ date: '2026-11-01', qty: 3 }], 0)).toEqual([
      { date: null, qty: 5 }, { date: '2026-11-01', qty: 3 },
    ]);
  });

  it('의뢰 수량까지만 센다 (납품 대기의 즉시 납품 가능 수량과 같다)', () => {
    expect(itemStockLots({ quantity: 10, produced_quantity: 14 }, [{ date: '2026-11-01', qty: 14 }], 0)).toEqual([
      { date: '2026-11-01', qty: 10 },
    ]);
  });

  it(`생산 후 ${STOCK_GRACE_DAYS}일이 지나면 2주 경과, 생산 월별로 모은다`, () => {
    const today = '2026-11-14';
    expect(daysBetween('2026-10-31', today)).toBe(14);
    const s = summarizeLots([
      { date: '2026-10-20', qty: 8 }, { date: '2026-10-31', qty: 2 }, { date: '2026-11-10', qty: 5 }, { date: null, qty: 3 },
    ], today);
    expect(s).toMatchObject({ qty: 18, overdue: 8, unknown: 3, oldest: '2026-10-20', newest: '2026-11-10', oldestDays: 25 });
    expect(s.byMonth).toEqual([{ month: '2026-10', qty: 10 }, { month: '2026-11', qty: 5 }, { month: '', qty: 3 }]);
  });
});
