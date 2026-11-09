import { describe, expect, it } from 'vitest';
import { applySuggestion, estimateKrw, normalizeLabel, rowRangesText, sheetTextForAi } from '@/lib/erp/ai-packaging';

describe('AI 포장 제안 — 보내는 글 · 받은 답 검사', () => {
  it('시트를 행번호 붙은 글로 — 빈 행은 빼고 칸 자리는 지킨다', () => {
    const text = sheetTextForAi([
      ['※ 7차 포장요망', null, ''],
      [],
      ['1동 1호', '5GN+12Ar+5DURA MAX', '', 455, 950, 10, '', ''],
      [new Date('2026-11-09T00:00:00Z')],
    ]);
    expect(text).toBe('1| ※ 7차 포장요망\n3| 1동 1호 | 5GN+12Ar+5DURA MAX |  | 455 | 950 | 10\n4| 2026-11-09');
  });

  it('행 번호를 범위 글로', () => {
    expect(rowRangesText([20, 15, 16, 17, 17, 30, 31])).toBe('15-17, 20, 30-31');
    expect(rowRangesText([])).toBe('');
  });

  it('범위 안에서 품목 행만 담고, 겹친 행은 앞 포장에, 빠진 행 · 빈 포장은 알린다', () => {
    const items = [15, 16, 17, 19, 20, 22, 23];
    const r = applySuggestion({
      understanding: '',
      cautions: [],
      packages: [
        { label: '3동 1~3호', ranges: [{ from: 15, to: 18 }], reason: '' },     // 18 은 합계 행 → 빠짐
        { label: '3동 4,5호', ranges: [{ from: 20, to: 17 }], reason: '' },     // 거꾸로 적은 범위, 17 은 겹침
        { label: '빈 포장', ranges: [{ from: 40, to: 45 }], reason: '' },
        { label: '  ', ranges: [{ from: 22, to: 22 }], reason: '' },
      ],
    }, items);
    expect(r.packages.map(p => [p.label, p.rows])).toEqual([
      ['3동 1~3호', [15, 16, 17]],
      ['3동 4,5호', [19, 20]],
      ['포장 4', [22]],
    ]);
    expect(r.duplicates).toEqual([17]);
    expect(r.unassigned).toEqual([23]);
    expect(r.emptyLabels).toEqual(['빈 포장']);
  });

  it('포장 이름을 회사 표기로 — 둘이면 콤마, 셋 이상 이어지면 ~', () => {
    expect(normalizeLabel('3동 4~5호')).toBe('3동 4,5호');
    expect(normalizeLabel(' 3동 1~3호 ')).toBe('3동 1~3호');
    expect(normalizeLabel('A-구간')).toBe('A-구간');
  });

  it('비용 어림 — Opus 5.5 단가', () => {
    // 입력 1만 · 출력 5천 토큰 = $0.04 + $0.10 = $0.14 → 196원
    expect(estimateKrw({ input_tokens: 10_000, output_tokens: 5_000 })).toBe(196);
  });
});
