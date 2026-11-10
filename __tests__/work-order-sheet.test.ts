import { describe, it, expect } from 'vitest';
import { planPages } from '@/components/work-order/WorkOrderSheet';

// 1mm = 96/25.4px. A4 297mm 에서 위아래 여백 12mm 씩, 바닥글 · 여유를 뺀 높이가 쪽마다 쓸 수 있는 높이다
const base = { header: 200, thead: 28, bottom: 82, footer: 24, blank: 22 };

describe('작업의뢰서 쪽 나누기 (2026-11-10 점검: 인쇄 · PDF 가 1장에서 잘리던 것)', () => {
  it('짧은 의뢰서는 한 쪽, 남는 자리는 빈 줄로 채운다', () => {
    const plan = planPages({ ...base, rows: [27, 27, 27] });
    expect(plan.pages).toEqual([[0, 1, 2]]);
    expect(plan.blanks).toBeGreaterThan(10);
  });

  it('긴 의뢰서는 줄을 자르지 않고 여러 쪽으로 나누고, 모든 줄이 한 번씩만 들어간다', () => {
    const rows = Array.from({ length: 120 }, (_, i) => (i % 7 === 0 ? 40 : 27));
    const plan = planPages({ ...base, rows });
    expect(plan.pages.length).toBeGreaterThan(3);
    expect(plan.pages.flat()).toEqual(rows.map((_, i) => i));
    // 쪽마다 줄 높이 합이 쓸 수 있는 높이를 넘지 않는다
    const body = 297 * 96 / 25.4 - 2 * 12 * 96 / 25.4 - base.footer - 6;
    plan.pages.forEach((p, i) => {
      const used = p.reduce((s, r) => s + rows[r], 0);
      const cap = body - base.thead - (i === 0 ? base.header : 0) - (i === plan.pages.length - 1 ? base.bottom : 0);
      expect(used).toBeLessThanOrEqual(cap);
    });
  });

  it('마지막 쪽에 비고 칸이 안 들어가면 끝의 몇 줄을 다음 쪽으로 넘긴다 — 빈 표만 있는 쪽은 만들지 않는다', () => {
    const body = 297 * 96 / 25.4 - 2 * 12 * 96 / 25.4 - base.footer - 6;
    // 첫 쪽을 비고 칸 직전까지 꽉 채운다
    const n = Math.floor((body - base.header - base.thead) / 27);
    const plan = planPages({ ...base, rows: Array(n).fill(27) });
    expect(plan.pages.length).toBe(2);
    expect(plan.pages[1].length).toBeGreaterThan(0);
    expect(plan.pages.flat().length).toBe(n);
  });
});
