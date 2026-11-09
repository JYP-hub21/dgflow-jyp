import { describe, expect, it } from 'vitest';
import { applySuggestion, buildPrompt, estimateKrw, normalizeLabel, rowRangesText, sheetTextForAi } from '@/lib/erp/ai-packaging';

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

  it('비용 어림 — Opus 5.5 단가, 캐시 읽기는 20분의 1', () => {
    // 입력 1만 · 출력 5천 토큰 = $0.04 + $0.10 = $0.14 → 196원
    expect(estimateKrw({ input_tokens: 10_000, output_tokens: 5_000 })).toBe(196);
    // 원문 5만 토큰을 캐시에서 읽으면 $0.01 → 14원
    expect(estimateKrw({ input_tokens: 0, output_tokens: 0, cache_read: 50_000 })).toBe(14);
  });

  it('보낼 글 — 원문 덩어리는 이어서 고쳐도 같고, 이어서 고칠 때는 앞선 요청 · 직전 제안 · 새 요청', () => {
    const base = { sheet_name: '7차', site_name: '남원주', customer_name: '우미', sheet_text: '15| 1동 1호', item_rows: [15, 16, 17], instruction: '' };
    const first = buildPrompt(base);
    expect(first.sheet).toContain('품목 행 (이 행들을 빠짐없이 포장에 넣는다): 15-17');
    expect(first.ask).toBe('## 사용자 요청\n없음 — 발주서 내용대로 제안한다.');
    const previous = { understanding: '', cautions: [], packages: [{ label: '1동', ranges: [{ from: 15, to: 17 }], reason: '' }] };
    const next = buildPrompt({ ...base, instruction: '2동은 합쳐 줘', history: ['5동 먼저', '  '], previous });
    expect(next.sheet).toBe(first.sheet);
    expect(next.ask).toContain('1) 5동 먼저');
    expect(next.ask).not.toContain('2) ');
    expect(next.ask).toContain('"label":"1동"');
    expect(next.ask).toContain('## 새 요청\n2동은 합쳐 줘');
  });
});
