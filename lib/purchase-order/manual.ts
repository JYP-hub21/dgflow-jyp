/**
 * 작업의뢰서를 발주 건에 "바로" 잇기 — 우리 ERP 변환기를 쓰지 않은 경우 (2026-11-02 사용자:
 * "ERP 업로드용 엑셀 만들기는 부가 기능이라 써도 그만 안 써도 그만. 수기로 규격정리하는 경우가 더 많을 수 있다.
 *  우리 시스템을 꼭 써야만 다음 단계로 넘어가면 안 된다").
 *
 * 변환기로 ERP 엑셀을 저장하면 포장(패키지)이 생기고 포장마다 작업의뢰서를 잇는다. 변환기를 안 쓰면 포장이 없어서
 * 이을 곳이 없었다 — 그래서 바로 이을 때 이 시트 이름의 포장을 하나 만들어 작업의뢰서를 붙인다(대조할 ERP 엑셀은 없다).
 * 끊으면 이 포장은 지운다. 단계 계산(deriveStage)은 포장과 똑같이 센다.
 */
export const MANUAL_SHEET = '직접 연결';

export const isManualPackage = (p: { sheet_name?: string | null }) => p.sheet_name === MANUAL_SHEET;

/** 현장명 비교용 — 띄어쓰기 · 괄호 · 흔한 꼬리말을 뗀다 */
function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/\(주\)|㈜|주식회사/g, '')
    .replace(/신축공사|건축공사|공사|현장|신축/g, '')
    .replace(/[\s()[\]{}·.,\-_/]/g, '');
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * 발주 건의 현장명과 작업의뢰서 현장명이 얼마나 닮았나 (0–1). 바로 이을 후보를 위에 놓는 데만 쓴다 — 이어 주지는 않는다.
 * 한쪽이 다른 쪽을 품으면 1, 아니면 두 글자 조각이 겹치는 정도.
 */
export function siteScore(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalize(a ?? '');
  const y = normalize(b ?? '');
  if (!x || !y) return 0;
  if (x.includes(y) || y.includes(x)) return 1;
  const A = bigrams(x);
  const B = bigrams(y);
  let common = 0;
  for (const g of A) if (B.has(g)) common++;
  return common / Math.max(1, Math.min(A.size, B.size));
}
