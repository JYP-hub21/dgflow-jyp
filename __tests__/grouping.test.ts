import { describe, it, expect } from 'vitest';
import { groupBySpec } from '@/lib/erp/grouping';

describe('groupBySpec', () => {
  it('동일 품명+규격 묶음 + 수량 합산', () => {
    const items = [
      { product_name: '24T 6CL+12A+6CL', width_mm: 1646, height_mm: 1748, quantity: 6, location_dong: '302', location_line: '1', location_floor: '1~6', location_room: '거실', location_type: '59A', location_window_type: '외창픽스' },
      { product_name: '24T 6CL+12A+6CL', width_mm: 1646, height_mm: 1748, quantity: 6, location_dong: '302', location_line: '2', location_floor: '1~6', location_room: '거실', location_type: '59B', location_window_type: '외창픽스' },
      { product_name: '24T 6CL+12A+6CL', width_mm: 1646, height_mm: 1748, quantity: 5, location_dong: '302', location_line: '3', location_floor: '2~6', location_room: '거실', location_type: '59A', location_window_type: '외창픽스' },
    ];

    const result = groupBySpec(items);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(17);
    expect(result[0].location_summary).toContain('302동');
    expect(result[0].location_summary).toContain('1~3라인');
  });

  it('다른 규격은 별도 그룹', () => {
    const items = [
      { product_name: '24T 6CL+12A+6CL', width_mm: 1646, height_mm: 1748, quantity: 6, location_dong: null, location_line: null, location_floor: null, location_room: null, location_type: null, location_window_type: null },
      { product_name: '24T 6CL+12A+6CL', width_mm: 800, height_mm: 1200, quantity: 4, location_dong: null, location_line: null, location_floor: null, location_room: null, location_type: null, location_window_type: null },
    ];

    const result = groupBySpec(items);
    expect(result).toHaveLength(2);
  });

  it('빈 배열', () => {
    expect(groupBySpec([])).toHaveLength(0);
  });
});
