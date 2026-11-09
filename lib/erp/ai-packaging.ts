/**
 * AI 포장 제안 — 발주서를 AI 가 읽고 포장(= ERP 시트 = 작업의뢰서 한 장)과 시트 순서를 제안한다 (2026-11-09).
 *
 * 왜: 포장 지시는 거래처 · 작성자마다 적는 방식이 달라 규칙(packaging-note.ts)이 못 읽는 발주서가 계속 들어온다.
 * 사람이 말로 적은 뜻("3동부터 싣게", "1~3호 같이")도 규칙으로는 못 받는다.
 *
 * 지키는 것 (규격정리 묶음은 매번 사람이 정한다 — 추천은 하되 확정은 사람이 누른다):
 *  · AI 답은 **제안**으로만 띄운다. 사람이 "이 제안으로 직접 짜기" 를 눌러야 포장 편집으로 넘어간다.
 *  · AI 는 행을 어느 포장에 넣을지와 포장 순서만 정한다. 시트 안 행 순서 · 합치기 · 위치 문자열은
 *    실물 ERP 와 대조해 맞춘 기존 규칙(buildErpUpload)이 그대로 만든다.
 *  · 한 행은 한 포장에만. 겹치거나 빠진 행은 숨기지 않고 알린다(빠진 행은 `_미배정` 시트로 간다).
 *
 * 이 파일은 화면 · 서버가 같이 쓰는 순수 함수만 둔다. AI 호출은 app/api/erp/ai-packaging/route.ts.
 */
import type { ManualPackage } from './packaging-rule';
import { newPackageId } from './packaging-rule';

/** AI 가 돌려주는 모양 — 서버의 zod 스키마와 같다 */
export interface AiPackagingSuggestion {
  /** 발주서를 어떻게 이해했는지 — 근거가 된 문구 */
  understanding: string;
  packages: { label: string; ranges: { from: number; to: number }[]; reason: string }[];
  /** 사람이 확인할 것 */
  cautions: string[];
}

export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  model: string;
}

/** 서버에 보내는 것 */
export interface AiPackagingRequest {
  sheet_name: string;
  site_name: string;
  customer_name: string;
  /** sheetTextForAi 결과 */
  sheet_text: string;
  /** 우리 파서가 품목으로 읽은 행 (이 행들만 포장에 넣는다) */
  item_rows: number[];
  /** 사람이 적은 지시 (선택) */
  instruction: string;
}

const MAX_ROWS = 3000;
const MAX_CELL = 80;

/**
 * 시트를 AI 가 읽을 글로 바꾼다 — 한 줄 = 엑셀 한 행, `행번호| 칸 | 칸 …`.
 * 빈 행은 뺀다. 칸 사이 빈칸은 남겨 열 위치가 어긋나지 않게 하고, 끝의 빈칸만 자른다.
 */
export function sheetTextForAi(matrix: unknown[][]): string {
  const lines: string[] = [];
  for (let i = 0; i < matrix.length && lines.length < MAX_ROWS; i++) {
    const cells = (matrix[i] ?? []).map(c => cellText(c));
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    if (cells.length === 0) continue;
    lines.push(`${i + 1}| ${cells.join(' | ')}`);
  }
  return lines.join('\n');
}

function cellText(c: unknown): string {
  if (c === null || c === undefined) return '';
  const s = c instanceof Date ? c.toISOString().slice(0, 10) : String(c);
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > MAX_CELL ? `${t.slice(0, MAX_CELL)}…` : t;
}

/** [15,16,17,20] → "15-17, 20" — 품목 행을 짧게 알려 준다 */
export function rowRangesText(rows: number[]): string {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
  }
  return parts.join(', ');
}

export interface AppliedSuggestion {
  packages: ManualPackage[];
  /** 두 포장에 동시에 들어간 행 — 앞 포장에 남겼다 */
  duplicates: number[];
  /** 어느 포장에도 안 들어간 품목 행 */
  unassigned: number[];
  /** 행이 하나도 없어 뺀 포장 이름 */
  emptyLabels: string[];
}

/**
 * AI 제안을 포장 편집이 쓰는 꼴로 바꾼다. 범위 안에서 **우리가 품목으로 읽은 행만** 담는다
 * (AI 가 합계 행 · 머리글까지 범위에 넣어도 그 행은 품목이 아니라 빠진다).
 */
export function applySuggestion(suggestion: AiPackagingSuggestion, itemRows: number[]): AppliedSuggestion {
  const items = new Set(itemRows);
  const taken = new Set<number>();
  const duplicates = new Set<number>();
  const packages: ManualPackage[] = [];
  const emptyLabels: string[] = [];

  suggestion.packages.forEach((p, i) => {
    const rows: number[] = [];
    for (const r of p.ranges) {
      const from = Math.min(r.from, r.to);
      const to = Math.max(r.from, r.to);
      for (let row = Math.floor(from); row <= to; row++) {
        if (!items.has(row)) continue;
        if (taken.has(row)) { if (!rows.includes(row)) duplicates.add(row); continue; }
        taken.add(row);
        rows.push(row);
      }
    }
    const label = normalizeLabel(p.label) || `포장 ${i + 1}`;
    if (rows.length === 0) { emptyLabels.push(label); return; }
    packages.push({ id: newPackageId(), label, rows: rows.sort((a, b) => a - b) });
  });

  return {
    packages,
    duplicates: [...duplicates].sort((a, b) => a - b),
    unassigned: itemRows.filter(r => !taken.has(r)).sort((a, b) => a - b),
    emptyLabels,
  };
}

/**
 * 포장 이름을 회사 표기로 맞춘다 — 호가 3개 이상 이어질 때만 `~`, 둘이면 콤마 (`4~5호` → `4,5호`).
 * 실물 ERP 시트 이름과 같은 규칙이다 (data/ERP-RULES.md "호" 표기).
 */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/(\d+)\s*~\s*(\d+)호/g, (m, a, b) => (Number(b) === Number(a) + 1 ? `${a},${b}호` : m));
}

/** 이번 요청 비용 어림 (Claude Opus 5.5: 입력 100만 토큰 $4 · 출력 $20, 1달러 1,400원으로 계산) */
export function estimateKrw(usage: Pick<AiUsage, 'input_tokens' | 'output_tokens'>): number {
  const usd = usage.input_tokens / 1_000_000 * 4 + usage.output_tokens / 1_000_000 * 20;
  return Math.round(usd * 1400);
}
