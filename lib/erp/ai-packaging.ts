/**
 * DG 프리즘 — 발주서 규격정리 전문가 AI (2026-11-09, 2.0).
 *
 * 사용자: "발주서 규격정리에 한해서는 내가 만든 AI 가 전문가여야 해 — 어떤 요구사항이나 명령이든 다 들어줄 수 있어야지."
 * 그래서 포장만 짜던 1.0 에서 할 수 있는 일을 넓혔다. AI 는 계획(JSON)만 내고, 적용은 이 파일과 기존 규칙이 한다.
 *
 *  · answer      — 질문에 답한다 ("3동은 몇 장이에요?"). 미리보기는 그대로 둔다.
 *  · load_sheets — 다른 차수 시트가 필요하면(“1차와 2차 합쳐서”) 그 시트들을 불러 달라고 한다. 화면이 불러온 뒤 같은 요청을 다시 보낸다.
 *  · arrange     — 포장(행 범위) · 시트 순서 · 포장 안 행 순서(ERP 규칙 / 발주서 순서) · 이번에 뺄 행 ·
 *                  위치 글자 고치기 · 규격정리 우측 사내 품명을 정한다.
 *
 * 지키는 것:
 *  · 가로 · 세로 · 수량 같은 숫자는 AI 가 바꾸지 못한다 — 숫자는 발주서에서 읽은 그대로다(유리를 잘못 자르면 안 된다).
 *  · 같은 규격 합치기 · 위치 조립 · 기본 행 순서는 실물 ERP 와 대조해 맞춘 기존 규칙(buildErpUpload)이 한다.
 *  · 한 행은 한 포장에만. 겹치거나 빠진 행은 숨기지 않고 알린다(빠진 행은 `_미배정` 시트로 간다).
 *
 * 이 파일은 화면 · 서버가 같이 쓰는 순수 함수만 둔다. AI 호출은 app/api/erp/ai-packaging/route.ts.
 */
import type { ManualPackage } from './packaging-rule';
import { newPackageId } from './packaging-rule';
import { keyerFor, keysText, splitKey } from './multi-sheet';

/** 행 범위 — 어느 시트의 몇 행부터 몇 행까지 (양끝 포함) */
export interface RowRange { sheet: string; from: number; to: number }

export type AiAction = 'arrange' | 'answer' | 'load_sheets';

/** AI 가 돌려주는 계획 — 서버의 zod 스키마와 같다 */
export interface AiPlan {
  action: AiAction;
  /** 사용자에게 하는 답 — 질문이면 답, 작업이면 무엇을 했는지 */
  reply: string;
  /** 발주서를 어떻게 이해했는지 — 근거가 된 행 · 문구 */
  understanding: string;
  /** load_sheets 일 때 불러올 시트(합칠 시트 전부). 아니면 지금 시트 그대로 */
  sheets: string[];
  /** packages 에 넣을 포장 수 — 목록을 다 채웠는지 검사한다 */
  package_count: number;
  packages: { label: string; ranges: RowRange[]; reason: string; row_order: 'erp' | 'source' }[];
  /** 이번 ERP 엑셀에서 뺄 품목 행 (사람이 빼 달라고 한 것) */
  exclude: (RowRange & { reason: string })[];
  /** 위치 글자 고치기 — ranges 가 비면 전체 */
  location_edits: { find: string; replace: string; ranges: RowRange[] }[];
  /** 규격정리 우측 품명(사내 · ERP 품목명) 제안 */
  product_names: { from: string; to: string }[];
  /** 사람이 확인할 것 */
  cautions: string[];
}

export interface AiUsage {
  /** 캐시를 거치지 않은 입력 */
  input_tokens: number;
  output_tokens: number;
  /** 캐시에서 읽은 입력 (원문을 다시 읽을 때 — 20분의 1 값) */
  cache_read?: number;
  /** 캐시에 처음 넣은 입력 (1.25배 값) */
  cache_write?: number;
  model: string;
}

/** 불러온 시트 하나 */
export interface AiSheetInput {
  name: string;
  /** sheetTextForAi 결과 */
  text: string;
  /** 우리 파서가 품목으로 읽은 엑셀 행 */
  item_rows: number[];
}

/** 서버에 보내는 것 */
export interface AiPackagingRequest {
  site_name: string;
  customer_name: string;
  /** 지금 불러온 시트들 (하나 이상) */
  sheets: AiSheetInput[];
  /** 파일의 모든 시트 — 다른 차수를 불러 달라고 할 수 있게 */
  available_sheets: { name: string; rows: number }[];
  /** 지금 미리보기에 보이는 포장과 그 방식 */
  current: { mode: string; packages: { label: string; ranges: RowRange[] }[] } | null;
  /** 이번에 사람이 적은 요청 (비우면 발주서대로) */
  instruction: string;
  /** 앞서 한 요청들 — 오래된 것부터 (이어서 고칠 때) */
  history?: string[];
  /** 직전 계획 — 있으면 그걸 바탕으로 고친다 */
  previous?: AiPlan | null;
}

/** 한 번에 적을 수 있는 요청 길이 — 장황하게 적어도 된다 */
export const MAX_INSTRUCTION = 3000;

/**
 * AI 에게 보낼 글 두 덩어리.
 * `sheet` 는 발주서 원문(불러온 시트 전부)이라 이어서 고쳐도 그대로다 — 서버가 캐시해 두 번째부터 싸게 읽는다.
 * `ask` 는 지금 화면 상태 · 요청 부분.
 */
export function buildPrompt(req: AiPackagingRequest): { sheet: string; ask: string } {
  const sheet = [
    `거래처: ${req.customer_name || '(못 읽음)'} / 현장: ${req.site_name || '(못 읽음)'}`,
    `파일의 모든 시트: ${req.available_sheets.map(s => `${s.name}(${s.rows}행)`).join(', ')}`,
    `지금 불러온 시트: ${req.sheets.map(s => s.name).join(', ')}`,
    '',
    ...req.sheets.flatMap(s => [
      `### 시트 "${s.name}" — 품목 행(이 행들을 빠짐없이 포장에 넣거나 뺀다): ${rowRangesText(s.item_rows)}`,
      '(한 줄 = 엑셀 한 행, "행번호| 칸 | 칸 …")',
      s.text,
      '',
    ]),
  ].join('\n');

  const now = (req.instruction ?? '').trim().slice(0, MAX_INSTRUCTION);
  const current = req.current && req.current.packages.length > 0
    ? [
        `## 지금 미리보기의 포장 (${req.current.mode})`,
        ...req.current.packages.map((p, i) => `${i + 1}) ${p.label}: ${p.ranges.map(r => `${r.sheet} ${r.from}-${r.to}`).join(', ')}`),
        '',
      ]
    : [];
  if (!req.previous) {
    return { sheet, ask: [...current, `## 사용자 요청`, now || '없음 — 발주서 내용대로 포장을 짠다.'].join('\n') };
  }
  const history = (req.history ?? []).map(h => h.trim()).filter(Boolean).slice(-10);
  return {
    sheet,
    ask: [
      ...current,
      '## 지금까지 사용자가 한 요청 (순서대로)',
      ...(history.length > 0 ? history.map((h, i) => `${i + 1}) ${h.slice(0, MAX_INSTRUCTION)}`) : ['(없음 — 발주서 내용대로 짰다)']),
      '',
      '## 직전 계획',
      JSON.stringify(req.previous),
      '',
      '## 새 요청',
      now || '(없음)',
      '',
      '직전 계획을 바탕으로 새 요청을 반영해 전체 답을 다시 써라. 앞선 요청도 계속 지키되, 새 요청과 부딪히면 새 요청을 따른다.',
    ].join('\n'),
  };
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

/** 행 열쇠 묶음 → 시트별 연속 범위 (AI 에게 지금 포장을 알려 줄 때) */
export function keysToRanges(keys: number[], sheetNames: string[]): RowRange[] {
  const bySheet = new Map<number, number[]>();
  for (const k of keys) {
    const { index, row } = splitKey(k);
    bySheet.set(index, [...(bySheet.get(index) ?? []), row]);
  }
  const out: RowRange[] = [];
  for (const [index, rows] of [...bySheet.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...new Set(rows)].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      const from = sorted[i];
      while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
      out.push({ sheet: sheetNames[index] ?? '', from, to: sorted[i] });
    }
  }
  return out;
}

export interface AppliedPlan {
  packages: ManualPackage[];
  /** 사람이 빼 달라고 한 품목 행 (열쇠) */
  excluded: number[];
  /** 발주서 순서를 그대로 둘 행 (열쇠) */
  sourceOrder: number[];
  /** 위치 고치기 — keys 가 null 이면 전체 */
  locationEdits: { find: string; replace: string; keys: number[] | null }[];
  /** 발주서 품명 → 사내 품명 */
  productNames: Record<string, string>;
  /** 두 포장에 동시에 들어간 행 — 앞 포장에 남겼다 */
  duplicates: number[];
  /** 어느 포장에도, 뺀 목록에도 없는 품목 행 */
  unassigned: number[];
  /** 행이 하나도 없어 뺀 포장 이름 */
  emptyLabels: string[];
  /** 지금 불러오지 않은 시트를 가리킨 범위 */
  unknownSheets: string[];
}

/**
 * AI 계획을 화면이 쓰는 꼴(행 열쇠)로 바꾼다. 범위 안에서 **우리가 품목으로 읽은 행만** 담는다
 * (AI 가 합계 행 · 머리글까지 범위에 넣어도 그 행은 품목이 아니라 빠진다). 뺀 행은 포장보다 앞선다.
 */
export function applyPlan(plan: Pick<AiPlan, 'packages' | 'exclude' | 'location_edits' | 'product_names'>, sheets: Pick<AiSheetInput, 'name' | 'item_rows'>[]): AppliedPlan {
  const names = sheets.map(s => s.name);
  const keyer = keyerFor(names);
  const itemKeys: number[] = sheets.flatMap(s => s.item_rows.map(r => keyer(s.name, r)).filter((k): k is number => k !== null));
  const items = new Set(itemKeys);
  const unknown = new Set<string>();
  const expand = (ranges: RowRange[]): number[] => {
    const out: number[] = [];
    for (const r of ranges) {
      const from = Math.floor(Math.min(r.from, r.to));
      const to = Math.max(r.from, r.to);
      if (keyer(r.sheet, from) === null) { unknown.add(r.sheet); continue; }
      for (let row = from; row <= to; row++) {
        const k = keyer(r.sheet, row)!;
        if (items.has(k)) out.push(k);
      }
    }
    return out;
  };

  const excluded = new Set(expand(plan.exclude ?? []));
  const taken = new Set<number>();
  const duplicates = new Set<number>();
  const packages: ManualPackage[] = [];
  const emptyLabels: string[] = [];
  const sourceOrder: number[] = [];

  (plan.packages ?? []).forEach((p, i) => {
    const rows: number[] = [];
    for (const k of expand(p.ranges)) {
      if (excluded.has(k) || rows.includes(k)) continue;
      if (taken.has(k)) { duplicates.add(k); continue; }
      taken.add(k);
      rows.push(k);
    }
    const label = normalizeLabel(p.label) || `포장 ${i + 1}`;
    if (rows.length === 0) { emptyLabels.push(label); return; }
    packages.push({ id: newPackageId(), label, rows: rows.sort((a, b) => a - b) });
    if (p.row_order === 'source') sourceOrder.push(...rows);
  });

  const productNames: Record<string, string> = {};
  for (const n of plan.product_names ?? []) {
    const from = (n.from ?? '').trim();
    const to = (n.to ?? '').trim();
    if (from && to && from !== to) productNames[from] = to;
  }

  return {
    packages,
    excluded: [...excluded].sort((a, b) => a - b),
    sourceOrder,
    locationEdits: (plan.location_edits ?? [])
      .filter(e => (e.find ?? '') !== '' && e.find !== e.replace)
      .map(e => ({ find: e.find, replace: e.replace ?? '', keys: (e.ranges ?? []).length > 0 ? expand(e.ranges) : null })),
    productNames,
    duplicates: [...duplicates].sort((a, b) => a - b),
    unassigned: itemKeys.filter(k => !taken.has(k) && !excluded.has(k)).sort((a, b) => a - b),
    emptyLabels,
    unknownSheets: [...unknown],
  };
}

/** 위치 고치기를 ERP 행 위치에 적용한다 — 줄이 고치기 범위의 발주서 행을 하나라도 담고 있으면 */
export function editLocation(
  location: string, sourceRows: number[] | undefined, edits: AppliedPlan['locationEdits'],
): string {
  let out = location;
  for (const e of edits) {
    if (e.keys && !(sourceRows ?? []).some(k => e.keys!.includes(k))) continue;
    out = out.split(e.find).join(e.replace).replace(/\s{2,}/g, ' ').trim();
  }
  return out;
}

/** 열쇠 묶음을 사람이 읽을 글로 (시트가 여럿이면 시트 이름을 붙인다) */
export function keysLabel(keys: number[], sheetNames: string[]): string {
  return keysText(keys, sheetNames);
}

/**
 * 포장 이름을 회사 표기로 맞춘다 — 호가 3개 이상 이어질 때만 `~`, 둘이면 콤마 (`4~5호` → `4,5호`).
 * 실물 ERP 시트 이름과 같은 규칙이다 (data/ERP-RULES.md "호" 표기).
 */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/(\d+)\s*~\s*(\d+)호/g, (m, a, b) => (Number(b) === Number(a) + 1 ? `${a},${b}호` : m));
}

/**
 * 이번 요청 비용 어림 — Claude Opus 5.5 100만 토큰당 입력 $4 · 캐시 쓰기 $5 · 캐시 읽기 $0.20 · 출력 $20,
 * 1달러 1,400원으로 계산.
 */
export function estimateKrw(usage: Pick<AiUsage, 'input_tokens' | 'output_tokens' | 'cache_read' | 'cache_write'>): number {
  const usd = (usage.input_tokens * 4 + (usage.cache_write ?? 0) * 5 + (usage.cache_read ?? 0) * 0.2 + usage.output_tokens * 20) / 1_000_000;
  return Math.round(usd * 1400);
}
