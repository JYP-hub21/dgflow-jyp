import { describe, it, expect } from 'vitest';
import { compareSizes, checkSummary } from '@/lib/purchase-order/match';
import { deriveStage, stalledDays } from '@/lib/purchase-order/stage';
import { chunkCountOf, CHUNK_BYTES } from '@/lib/purchase-order/chunks';

const pkg = [
  { width_mm: 1719, height_mm: 1820, quantity: 15 },
  { width_mm: 763, height_mm: 1820, quantity: 30 },
  { width_mm: 755, height_mm: 950, quantity: 60 },
];

describe('ERP 엑셀 포장 ↔ 작업의뢰서 대조', () => {
  it('규격별 수량이 같으면 일치 — 행 순서 · 쪼개짐은 상관없다', () => {
    const wo = [
      { width_mm: 755, height_mm: 950, quantity: 40 },
      { width_mm: 1719, height_mm: 1820, quantity: 15 },
      { width_mm: 755, height_mm: 950, quantity: 20 },
      { width_mm: 763, height_mm: 1820, quantity: 30 },
    ];
    const r = compareSizes(pkg, wo);
    expect(r.ok).toBe(true);
    expect(r.score).toBe(1);
    expect(checkSummary(r)).toBe('규격 · 수량 일치');
  });

  it('ERP 에 수량을 잘못 넣었으면 어느 규격이 몇 장 다른지 짚는다', () => {
    const wo = [...pkg.slice(0, 2), { width_mm: 755, height_mm: 950, quantity: 59 }];
    const r = compareSizes(pkg, wo);
    expect(r.ok).toBe(false);
    expect(r.diffs).toEqual([{ width_mm: 755, height_mm: 950, expected: 60, actual: 59 }]);
  });

  it('가로 · 세로를 바꿔 넣은 것도 다른 규격으로 잡는다', () => {
    const wo = [...pkg.slice(0, 2), { width_mm: 950, height_mm: 755, quantity: 60 }];
    const r = compareSizes(pkg, wo);
    expect(r.ok).toBe(false);
    expect(r.diffs).toHaveLength(2);
  });

  it('복층 — 같은 규격 목록이 품명 블록(外/內)마다 되풀이되면 블록 수만큼 배수로 보고 일치', () => {
    const r = compareSizes(pkg, [...pkg, ...pkg]);
    expect(r.ok).toBe(true);
    expect(r.multiple).toBe(2);
    expect(checkSummary(r)).toContain('품명 블록 2개');
  });

  it('총량만 두 배이고 규격별로는 아니면 배수로 치지 않는다', () => {
    const wo = [{ width_mm: 1719, height_mm: 1820, quantity: 210 }];
    const r = compareSizes(pkg, wo);
    expect(r.multiple).toBe(1);
    expect(r.ok).toBe(false);
  });

  it('짝 찾기 점수 — 닮을수록 높다', () => {
    const near = compareSizes(pkg, [...pkg.slice(0, 2), { width_mm: 755, height_mm: 950, quantity: 59 }]).score;
    const far = compareSizes(pkg, [{ width_mm: 500, height_mm: 500, quantity: 10 }]).score;
    expect(near).toBeGreaterThan(0.99);
    expect(far).toBe(0);
  });
});

describe('발주 건 단계', () => {
  it('ERP 엑셀 전에는 저장된 단계 그대로', () => {
    expect(deriveStage('submitted', [])).toBe('submitted');
    expect(deriveStage('checked', [])).toBe('checked');
  });

  it('작업의뢰서가 일부만 오면 받는 중, 다 오면 생산 중, 다 만들면 완료', () => {
    const none = { work_order_id: null };
    const half = { work_order_id: 'a', total: 10, produced: 4 };
    const full = { work_order_id: 'b', total: 10, produced: 10 };
    expect(deriveStage('erp_ready', [none, none])).toBe('erp_ready');
    expect(deriveStage('erp_ready', [half, none])).toBe('linking');
    expect(deriveStage('erp_ready', [half, full])).toBe('producing');
    expect(deriveStage('erp_ready', [full, full])).toBe('done');
    expect(deriveStage('cancelled', [full])).toBe('cancelled');
  });

  it('확인 전으로 하루가 지나면 멈춘 건', () => {
    const base = { checked_at: null, erp_saved_at: null };
    const now = new Date('2026-10-22T12:00:00Z');
    expect(stalledDays({ ...base, stage: 'submitted', created_at: '2026-10-22T08:00:00Z' }, now)).toBeNull();
    expect(stalledDays({ ...base, stage: 'submitted', created_at: '2026-10-20T08:00:00Z' }, now)).toBe(2);
    // ERP 등록 대기는 ERP 엑셀을 저장한 때부터 센다
    expect(stalledDays({ stage: 'erp_ready', created_at: '2026-10-01T00:00:00Z', checked_at: null, erp_saved_at: '2026-10-21T12:00:00Z' }, now)).toBeNull();
    expect(stalledDays({ ...base, stage: 'done', created_at: '2026-01-01T00:00:00Z' }, now)).toBeNull();
  });
});

describe('파일 조각', () => {
  it('무료 요금제 한도(50MB) 아래 45MB 조각으로 나눈다 — 151MB 는 4조각', () => {
    expect(CHUNK_BYTES).toBeLessThan(50 * 1024 * 1024);
    expect(chunkCountOf(151_252_679)).toBe(4);
    expect(chunkCountOf(10)).toBe(1);
    expect(chunkCountOf(0)).toBe(1);
  });
});
