import { describe, expect, it } from 'vitest';
import {
  EMPTY_ORIGIN, isOtherNumber, markEdited, needsHandConfirm, pickBatch, replacedLabel, sameItems,
} from '@/app/(authenticated)/work-orders/receive/file-load';
import { mismatchLines, verifyScan } from '@/lib/work-order/verify';

/**
 * 작업의뢰서 등록 — 두 번째 파일을 올렸을 때 (2026-11-10 점검).
 * 사고: 2090 다음에 2573 PDF 를 올리면 머리글만 2573, 품목은 2090 이 남고 검산은 초록이었다.
 */
const f = (name: string) => ({ name });

describe('한 번에 놓은 파일 고르기', () => {
  it('PDF 하나 · 엑셀 하나 · 둘 다는 받는다', () => {
    expect(pickBatch([f('26-2090.pdf')])).toEqual({ pdf: f('26-2090.pdf'), excel: undefined });
    expect(pickBatch([f('2286.xlsx')])).toEqual({ pdf: undefined, excel: f('2286.xlsx') });
    // 같은 의뢰서의 엑셀 + PDF — 품목은 엑셀, 머리글은 PDF (화면이 정한다)
    expect(pickBatch([f('a.PDF'), f('a.xls')])).toEqual({ pdf: f('a.PDF'), excel: f('a.xls') });
  });

  it('PDF 둘 · 엑셀 둘은 어느 쪽을 쓸지 몰라 받지 않는다', () => {
    expect(pickBatch([f('26-2090.pdf'), f('26-2573.pdf')])).toHaveProperty('error');
    expect(pickBatch([f('a.xlsx'), f('b.csv')])).toHaveProperty('error');
  });
});

describe('품목을 갈아 끼울 때 물어볼까', () => {
  it('이전 파일 · 등록된 품목은 묻지 않고 바꾼다', () => {
    expect(needsHandConfirm({ kind: 'file', name: '26-2090.pdf', edited: false }, 17)).toBe(false);
    expect(needsHandConfirm({ kind: 'db', name: '26-2090', edited: false }, 17)).toBe(false);
    expect(needsHandConfirm(EMPTY_ORIGIN, 0)).toBe(false);
  });

  it('손으로 친 것 · 파일을 손으로 고친 것은 묻는다', () => {
    expect(needsHandConfirm(markEdited(EMPTY_ORIGIN), 3)).toBe(true);
    expect(needsHandConfirm(markEdited({ kind: 'file', name: 'x.pdf', edited: false }), 17)).toBe(true);
    expect(needsHandConfirm(markEdited({ kind: 'db', edited: false }), 5)).toBe(true);
    // 빈 줄만 있으면 잃을 게 없다
    expect(needsHandConfirm(markEdited(EMPTY_ORIGIN), 0)).toBe(false);
  });

  it('빈 표를 고치면 손으로 친 표, 파일 표를 고치면 파일 + 고침', () => {
    expect(markEdited(EMPTY_ORIGIN)).toEqual({ kind: 'hand', edited: true });
    expect(markEdited({ kind: 'file', name: 'a.pdf', edited: false })).toEqual({ kind: 'file', name: 'a.pdf', edited: true });
  });
});

describe('알림 문구 · 비교', () => {
  it('무엇을 바꿨는지', () => {
    expect(replacedLabel({ kind: 'file', name: '26-2090.pdf', edited: false }, 17)).toBe('이전 파일 26-2090.pdf 의 품목 17행');
    expect(replacedLabel({ kind: 'db', name: '26-2090', edited: false }, 12)).toBe('기존 등록 품목 12행');
    expect(replacedLabel({ kind: 'hand', edited: true }, 3)).toBe('직접 입력한 품목 3행');
    expect(replacedLabel({ kind: 'file', name: '26-2090.pdf', edited: false }, 0)).toBeNull();
  });

  it('수정 중인 의뢰서와 번호가 다른가', () => {
    expect(isOtherNumber('26-2090', '26-2573')).toBe(true);
    expect(isOtherNumber('26-2090', ' 26-2090 ')).toBe(false);
    expect(isOtherNumber('26-2090', null)).toBe(false);
    expect(isOtherNumber('', '26-2573')).toBe(false);
  });

  it('규격 · 수량이 줄마다 같은가', () => {
    const a = [{ width_mm: 1423, height_mm: 1776, quantity: 2 }, { width_mm: 702, height_mm: 1759, quantity: 4 }];
    expect(sameItems(a, a.map((x) => ({ ...x })))).toBe(true);
    expect(sameItems(a, [a[0]])).toBe(false);
    expect(sameItems(a, [a[0], { ...a[1], quantity: 5 }])).toBe(false);
  });
});

describe('저장 전 검산 확인 — 어긋난 곳 (mismatchLines)', () => {
  const item = (no: number, quantity: number, area_m2: number, product_name = '22T') =>
    ({ no, product_name, width_mm: 1000, height_mm: 1000, quantity, area_m2, remark: null });

  it('다 맞으면 빈 배열 — 확인 창이 안 뜬다', () => {
    const check = verifyScan({
      items: [item(1, 2, 2), item(2, 3, 3)],
      printed_subtotals: [{ after_no: 2, quantity: 5, area_m2: 5 }],
      printed_total: { quantity: 5, area_m2: 5 },
    });
    expect(mismatchLines(check)).toEqual([]);
  });

  it('어긋난 소계 · 합계를 짚는다', () => {
    const check = verifyScan({
      items: [item(1, 2, 2), item(2, 3, 3), item(3, 4, 4, '24T')],
      printed_subtotals: [{ after_no: 2, quantity: 6, area_m2: 5 }, { after_no: 3, quantity: 4, area_m2: 4 }],
      printed_total: { quantity: 10, area_m2: 9.5 },
    });
    expect(mismatchLines(check)).toEqual([
      'No.1~2 소계 — 수량 표 5 / 의뢰서 6',
      '합계 — 수량 표 9 / 의뢰서 10, 면적 표 9.00 / 의뢰서 9.50',
    ]);
  });

  it('소계가 많이 어긋나면 몇 곳만 보이고 나머지는 셈만', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(i + 1, 1, 1, `P${i}`));
    const check = verifyScan({
      items,
      printed_subtotals: items.map((it) => ({ after_no: it.no, quantity: 2, area_m2: 1 })),
      printed_total: null,
    });
    const lines = mismatchLines(check, 5);
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe('그 밖의 소계 3곳');
  });
});
