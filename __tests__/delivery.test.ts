import { describe, expect, it } from 'vitest';
import {
  dailyDeliveryTotals, deliveriesByDateAndOrder, deliveryTodo, isMonth, monthRange, shiftMonth, type DeliveryLog,
} from '@/lib/production/delivery';

const log = (id: string, wo: string, date: string, quantity: number, area: number, note: string | null = null): DeliveryLog => ({
  id, work_order_id: wo, work_order_item_id: `${wo}-i`, delivery_date: date, quantity, area_m2: area, note,
});

describe('납품 메뉴 계산', () => {
  it('달 범위 — 말일까지, 윤년 2월', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(isMonth('2026-11')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth(undefined)).toBe(false);
  });

  it('날마다 한 점 — 납품 없는 날은 0', () => {
    const pts = dailyDeliveryTotals([log('a', 'w1', '2026-11-02', 3, 1.5), log('b', 'w2', '2026-11-02', 2, 0.56)], '2026-11-01', '2026-11-03');
    expect(pts.map(p => [p.label, p.weekday, p.quantity, p.area_m2])).toEqual([
      ['11/1', '일', 0, 0], ['11/2', '월', 5, 2.06], ['11/3', '화', 0, 0],
    ]);
  });

  it('날짜별 · 의뢰서별로 묶는다 — 최근 날짜가 위, 비고는 한 번만', () => {
    const days = deliveriesByDateAndOrder([
      log('a', 'w1', '2026-11-02', 3, 1.5, '1차분'),
      log('b', 'w1', '2026-11-02', 1, 0.5, '1차분'),
      log('c', 'w2', '2026-11-02', 6, 2),
      log('d', 'w1', '2026-11-05', 4, 2),
    ]);
    expect(days.map(d => d.date)).toEqual(['2026-11-05', '2026-11-02']);
    expect(days[1].quantity).toBe(10);
    expect(days[1].orders).toEqual([
      { work_order_id: 'w2', quantity: 6, area_m2: 2, notes: [] },
      { work_order_id: 'w1', quantity: 4, area_m2: 2, notes: ['1차분'] },
    ]);
  });

  it('할 일 — 미납 · 바로 나갈 수 있는 수량(재고로 더 나가도 음수가 안 된다)', () => {
    const items = [{ quantity: 10, produced_quantity: 10 }, { quantity: 4, produced_quantity: 2 }];
    expect(deliveryTodo(items, 3)).toEqual({ quantity: 14, produced: 12, delivered: 3, remaining: 11, ready: 9 });
    expect(deliveryTodo(items, 13)).toMatchObject({ remaining: 1, ready: 0 });
  });
});
