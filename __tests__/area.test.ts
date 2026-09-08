import { describe, it, expect } from 'vitest';
import { calculateArea } from '@/lib/calc/area';

describe('calculateArea', () => {
  it('기본 면적 계산', () => {
    // 1646 x 1748 x 17 = 48.88m2
    expect(calculateArea(1646, 1748, 17)).toBeCloseTo(48.89, 1);
  });

  it('단일 수량', () => {
    // 1000 x 1000 x 1 = 1.00 m2
    expect(calculateArea(1000, 1000, 1)).toBe(1);
  });

  it('소수점 반올림', () => {
    // 500 x 333 x 1 = 0.1665 → 0.17
    expect(calculateArea(500, 333, 1)).toBe(0.17);
  });

  it('수량이 0이면 0', () => {
    expect(calculateArea(1000, 1000, 0)).toBe(0);
  });
});
