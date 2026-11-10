import { describe, expect, it } from 'vitest';
import {
  applyPlan, buildPrompt, editLocation, estimateKrw, keysToRanges, normalizeLabel, rowRangesText, sheetTextForAi,
  type AiPackagingRequest, type AiPlan,
} from '@/lib/erp/ai-packaging';

const plan = (p: Partial<AiPlan>): AiPlan => ({
  action: 'arrange', reply: '', understanding: '', sheets: [], package_count: p.packages?.length ?? 0,
  packages: [], exclude: [], location_edits: [], product_names: [], cautions: [], ...p,
});
const pkg = (label: string, ranges: [string, number, number][], row_order: 'erp' | 'source' = 'erp') =>
  ({ label, reason: '', row_order, ranges: ranges.map(([sheet, from, to]) => ({ sheet, from, to })) });

describe('DG 프리즘 — 보내는 글 · 받은 계획 적용', () => {
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

  it('시트 하나 — 품목 행만 담고, 겹친 행은 앞 포장에, 뺀 행이 포장보다 앞서고, 빠진 행 · 빈 포장을 알린다', () => {
    const a = applyPlan(plan({
      packages: [
        pkg('3동 1~3호', [['7차', 15, 18]]),            // 18 은 합계 행 → 빠짐
        pkg('3동 4~5호', [['7차', 20, 17]], 'source'), // 거꾸로 적은 범위, 17 은 겹침, 이름은 4,5호로
        pkg('빈 포장', [['7차', 40, 45]]),
        pkg('  ', [['7차', 22, 23]]),                  // 23 은 뺀 행
      ],
      exclude: [{ sheet: '7차', from: 23, to: 23, reason: '발코니' }],
    }), [{ name: '7차', item_rows: [15, 16, 17, 19, 20, 22, 23, 24] }]);
    expect(a.packages.map(p => [p.label, p.rows])).toEqual([
      ['3동 1~3호', [15, 16, 17]],
      ['3동 4,5호', [19, 20]],
      ['포장 4', [22]],
    ]);
    expect(a.duplicates).toEqual([17]);
    expect(a.excluded).toEqual([23]);
    expect(a.unassigned).toEqual([24]);
    expect(a.emptyLabels).toEqual(['빈 포장']);
    expect(a.sourceOrder).toEqual([19, 20]);
  });

  it('여러 시트 — 시트 이름으로 행 열쇠를 만들고, 안 불러온 시트는 알린다', () => {
    const a = applyPlan(plan({
      packages: [pkg('3동', [['1차', 15, 16], ['2차', 15, 15]]), pkg('4동', [['3차', 1, 9]])],
    }), [{ name: '1차', item_rows: [15, 16] }, { name: '2차', item_rows: [15] }]);
    expect(a.packages.map(p => p.rows)).toEqual([[100015, 100016, 200015]]);
    expect(a.unknownSheets).toEqual(['3차']);
    expect(keysToRanges([100015, 100016, 200015, 200017], ['1차', '2차'])).toEqual([
      { sheet: '1차', from: 15, to: 16 }, { sheet: '2차', from: 15, to: 15 }, { sheet: '2차', from: 17, to: 17 },
    ]);
  });

  it('위치 고치기 · 사내 품명 — 범위가 없으면 전체, 같은 이름 · 빈 값은 버린다', () => {
    const a = applyPlan(plan({
      location_edits: [{ find: '구조마감 ', replace: '', ranges: [] }, { find: '外', replace: '외', ranges: [{ sheet: '7차', from: 15, to: 15 }] }],
      product_names: [{ from: '5GN+12Ar+5DURA MAX', to: '22T 5newGN+12AR.+5로이' }, { from: 'A', to: 'A' }, { from: '', to: 'B' }],
    }), [{ name: '7차', item_rows: [15, 16] }]);
    expect(a.productNames).toEqual({ '5GN+12Ar+5DURA MAX': '22T 5newGN+12AR.+5로이' });
    expect(editLocation('구조마감 근생/1층 (外)', [16], a.locationEdits)).toBe('근생/1층 (外)');
    expect(editLocation('구조마감 근생/1층 (外)', [15], a.locationEdits)).toBe('근생/1층 (외)');
  });

  it('포장 이름을 회사 표기로 — 둘이면 콤마, 셋 이상 이어지면 ~', () => {
    expect(normalizeLabel('3동 4~5호')).toBe('3동 4,5호');
    expect(normalizeLabel(' 3동 1~3호 ')).toBe('3동 1~3호');
    expect(normalizeLabel('A-구간')).toBe('A-구간');
  });

  it('비용 어림 — Opus 5.5 단가, 캐시 읽기는 20분의 1', () => {
    expect(estimateKrw({ input_tokens: 10_000, output_tokens: 5_000 })).toBe(196);
    expect(estimateKrw({ input_tokens: 0, output_tokens: 0, cache_read: 50_000 })).toBe(14);
  });

  it('보낼 글 — 원문 덩어리에 불러온 시트 전부 · 모든 시트 이름, 요청 덩어리에 지금 포장 · 앞선 요청 · 직전 계획', () => {
    const base: AiPackagingRequest = {
      site_name: '남원주', customer_name: '우미',
      sheets: [{ name: '1차', text: '15| 1동 1호', item_rows: [15, 16, 17] }, { name: '2차', text: '15| 2동 1호', item_rows: [15] }],
      available_sheets: [{ name: '1차', rows: 544 }, { name: '2차', rows: 544 }, { name: '3차', rows: 545 }],
      current: { mode: '발주서 포장 지시문', packages: [{ label: '1동', ranges: [{ sheet: '1차', from: 15, to: 17 }] }] },
      instruction: '',
    };
    const first = buildPrompt(base);
    expect(first.sheet).toContain('파일의 모든 시트: 1차(544행), 2차(544행), 3차(545행)');
    expect(first.sheet).toContain('### 시트 "2차" — 품목 행(이 행들을 빠짐없이 포장에 넣거나 뺀다): 15');
    expect(first.ask).toContain('1) 1동: 1차 15-17');
    expect(first.ask).toContain('없음 — 발주서 내용대로 포장을 짠다.');
    const next = buildPrompt({ ...base, instruction: '2동은 합쳐 줘', history: ['5동 먼저', '  '], previous: plan({ packages: [pkg('1동', [['1차', 15, 17]])] }) });
    expect(next.sheet).toBe(first.sheet);
    expect(next.ask).toContain('1) 5동 먼저');
    expect(next.ask).toContain('"label":"1동"');
    expect(next.ask).toContain('## 새 요청\n2동은 합쳐 줘');
  });

  it('발주서 파일이 여럿이면 — 파일 번호와 파일별 시트 순서를 적는다', () => {
    const p = buildPrompt({
      site_name: '부산', customer_name: '우미',
      sheets: [{ name: '① 5차', text: '15| 1동 1호', item_rows: [15] }],
      available_sheets: [{ name: '① 합계', rows: 20 }, { name: '① 5차', rows: 300 }, { name: '② 5차', rows: 310 }],
      files: [
        { mark: '①', name: '1동 5차발주서.xlsx', sheets: [{ name: '① 합계', rows: 20 }, { name: '① 5차', rows: 300 }] },
        { mark: '②', name: '2동 5차발주서.xlsx', sheets: [{ name: '② 5차', rows: 310 }] },
      ],
      current: null, instruction: '',
    });
    expect(p.sheet).toContain('발주서 파일 2개');
    expect(p.sheet).toContain('① 1동 5차발주서.xlsx — 시트 1) ① 합계(20행) 2) ① 5차(300행)');
    expect(p.sheet).toContain('② 2동 5차발주서.xlsx — 시트 1) ② 5차(310행)');
    expect(p.sheet).not.toContain('파일의 모든 시트:');
  });
});
