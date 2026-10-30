import { describe, expect, it } from 'vitest';
import { blockTotals, daysBetweenDates, formatDays, itemNo, productionDaysByItem } from '@/lib/production/item-view';
import { decodeCsv, isCsv } from '@/lib/excel/read-file';

describe('생산 화면 품목 번호 · 소계 · 생산 날짜', () => {
  it('No. 는 작업의뢰서 순서(sort_order 0부터)에 1을 더한 번호, 없으면 놓인 자리로', () => {
    expect(itemNo({ sort_order: 6 })).toBe(7);
    expect(itemNo({ sort_order: null }, 2)).toBe(3);
    expect(itemNo({})).toBe(1);
  });

  it('소계 — 이어지는 같은 품명끼리만 묶고, 떨어져 다시 나오면 새 덩어리', () => {
    const items = [
      { product_name: '24T 5CL+14A+5CL', quantity: 10, produced_quantity: 10 },
      { product_name: '24T 5CL+14A+5CL', quantity: 4, produced_quantity: 1 },
      { product_name: '22T 5PL+12A+5CL', quantity: 3, produced_quantity: 0 },
      { product_name: '24T 5CL+14A+5CL', quantity: 2, produced_quantity: 2 },
    ];
    expect(blockTotals(items)).toEqual([
      { product_name: '24T 5CL+14A+5CL', endIndex: 1, count: 2, quantity: 14, produced: 11 },
      { product_name: '22T 5PL+12A+5CL', endIndex: 2, count: 1, quantity: 3, produced: 0 },
      { product_name: '24T 5CL+14A+5CL', endIndex: 3, count: 1, quantity: 2, produced: 2 },
    ]);
    expect(blockTotals([])).toEqual([]);
  });

  it('생산 날짜 — 품목마다 날짜별로 더하고 날짜순, 품목이 없는 기록은 뺀다', () => {
    const map = productionDaysByItem([
      { work_order_item_id: 'a', production_date: '2026-10-09', quantity_completed: 1 },
      { work_order_item_id: 'a', production_date: '2026-10-01', quantity_completed: 20 },
      { work_order_item_id: 'a', production_date: '2026-10-01', quantity_completed: 5 },
      { work_order_item_id: 'b', production_date: '2026-10-30', quantity_completed: 3 },
      { work_order_item_id: null, production_date: '2026-10-30', quantity_completed: 9 },
    ]);
    expect(map.get('a')).toEqual([{ date: '2026-10-01', quantity: 25 }, { date: '2026-10-09', quantity: 1 }]);
    expect(map.get('b')).toEqual([{ date: '2026-10-30', quantity: 3 }]);
    expect(map.size).toBe(2);
  });

  it('날짜 글 — 많으면 마지막 몇 날만 보이고 앞은 "외 n일"', () => {
    const days = [
      { date: '2026-10-01', quantity: 25 }, { date: '2026-10-09', quantity: 1 },
      { date: '2026-10-12', quantity: 1 }, { date: '2026-10-30', quantity: 2 },
    ];
    expect(formatDays(days.slice(0, 2))).toBe('10/1 25 · 10/9 1');
    expect(formatDays(days)).toBe('외 1일 · 10/9 1 · 10/12 1 · 10/30 2');
    expect(formatDays([])).toBe('');
  });

  it('날 수 — 뒤 날짜가 늦으면 양수, 달 · 해를 넘어도 맞다', () => {
    expect(daysBetweenDates('2026-10-16', '2026-10-30')).toBe(14);
    expect(daysBetweenDates('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetweenDates('2026-10-30', '2026-10-29')).toBe(-1);
  });
});

describe('CSV 읽기 — 한국 엑셀 CSV 는 EUC-KR', () => {
  const bytes = (...b: number[]) => new Uint8Array(b).buffer;

  it('UTF-8 은 그대로, 앞의 BOM 은 떼고', () => {
    expect(decodeCsv(new TextEncoder().encode('품명,수량').buffer as ArrayBuffer)).toBe('품명,수량');
    expect(decodeCsv(bytes(0xef, 0xbb, 0xbf, 0x41, 0x2c, 0x42))).toBe('A,B');
  });

  it('UTF-8 이 아니면 EUC-KR 로 다시 읽는다 ("가나")', () => {
    expect(decodeCsv(bytes(0xb0, 0xa1, 0xb3, 0xaa))).toBe('가나');
  });

  it('확장자는 대소문자 구분 없이', () => {
    expect(isCsv('목록.CSV')).toBe(true);
    expect(isCsv('목록.xlsx')).toBe(false);
  });
});
