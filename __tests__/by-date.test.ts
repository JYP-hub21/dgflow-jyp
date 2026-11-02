import { describe, expect, it } from 'vitest';
import { dayLabel, groupByDate, monthLabel } from '@/lib/production/by-date';
import { daysSummary } from '@/lib/production/item-view';

const log = (date: string, item: string, qty: number, extra: Partial<{ shift: string; line_number: number; area_m2: number }> = {}) => ({
  work_order_item_id: item, production_date: date, quantity_completed: qty,
  area_m2: extra.area_m2 ?? qty, shift: extra.shift ?? 'day', line_number: extra.line_number ?? 1,
});

describe('날짜별 생산 — 한 의뢰서를 여러 날 · 여러 달에 걸쳐 만들 때', () => {
  const logs = [
    log('2026-10-01', 'b', 20), log('2026-10-01', 'a', 5), log('2026-10-01', 'a', 3),
    log('2026-10-01', 'a', 2, { shift: 'night', line_number: 2 }),
    log('2026-10-09', 'b', 1), log('2026-11-02', 'a', 4),
  ];
  const order = (id: string | null) => (id === 'a' ? 1 : 2);

  it('월 → 날짜 최근 것부터, 날짜마다 합계 · 품목 수', () => {
    const months = groupByDate(logs, order);
    expect(months.map(m => [m.month, m.quantity, m.days.map(d => d.date)])).toEqual([
      ['2026-11', 4, ['2026-11-02']],
      ['2026-10', 31, ['2026-10-09', '2026-10-01']],
    ]);
    const oct1 = months[1].days[1];
    expect([oct1.quantity, oct1.itemCount]).toEqual([30, 2]);
  });

  it('그날 품목은 종이 순서로, 같은 품목이라도 주야 · 호기가 다르면 따로', () => {
    const oct1 = groupByDate(logs, order)[1].days[1];
    expect(oct1.rows.map(r => [r.itemId, r.shift, r.line, r.quantity])).toEqual([
      ['a', 'day', 1, 8], ['a', 'night', 2, 2], ['b', 'day', 1, 20],
    ]);
  });

  it('이름표 — 요일 · 달', () => {
    expect(dayLabel('2026-10-31')).toBe('10/31 (토)');
    expect(monthLabel('2026-10')).toBe('2026년 10월');
  });

  it('품목 칸 요약 — 이틀까지는 날짜와 수량, 많으면 "n일 · 마지막"', () => {
    expect(daysSummary([{ date: '2026-10-30', quantity: 1 }, { date: '2026-10-31', quantity: 2 }])).toBe('10/30 1 · 10/31 2');
    const many = Array.from({ length: 23 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, quantity: 1 }));
    expect(daysSummary(many)).toBe('23일 · 마지막 10/23');
  });
});
