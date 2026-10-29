import type { WorkOrderInput, WorkOrderItemInput } from './verify';

/**
 * ERP 가 내보낸 작업의뢰서 엑셀을 읽는다.
 *
 * ERP 출력 메뉴에서 엑셀로 받으면 품목 표가 그대로 나온다 (2286.xlsx 로 확인).
 * 머리글(의뢰번호·업체명·현장명·날짜)은 **엑셀에 실리지 않는다** — 화면에서 사람이 친다.
 *
 *   No | 거래처 | 품명 | 규격 | 수량 | 면적 | 비고
 *
 * 발주서 파서와 달리 거래처별 양식 프로파일이 필요 없다. ERP 가 찍어내는 한 가지 모양이고
 * 사람이 손댈 여지가 없다. 그래도 열은 **이름으로 찾는다** — 열 순서가 바뀌어도 읽히게.
 */

export interface ParsedWorkOrder extends WorkOrderInput {
  /** 엑셀에 거래처가 적혀 있으면 가져온다. 비어 있는 경우가 많다 */
  customer_label: string | null;
  /** 읽다가 건너뛴 줄 — 사람이 확인하라고 올린다 */
  warnings: string[];
}

/** 헤더에서 찾을 열. 없으면 그 열은 비운다 */
const COLUMNS = {
  no: ['no', 'no.', '번호'],
  customer: ['거래처', '업체', '업체명'],
  product: ['품명', '품목', '품목명'],
  spec: ['규격', '사이즈', '규격(가로x세로)'],
  quantity: ['수량', '매수'],
  area: ['면적'],
  remark: ['비고', '위치'],
} as const;

type ColumnKey = keyof typeof COLUMNS;

function norm(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, '').toLowerCase();
}

function text(v: unknown): string {
  return String(v ?? '').trim();
}

/** `"1,234"` · `1234` · `" 1234 "` → 1234. 못 읽으면 null */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = text(v).replace(/,/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * `"1,662 X 1,975"` → `[1662, 1975]`.
 * 구분자는 X · x · × · * 를 모두 받는다 — 문서마다 다르게 찍힌다.
 */
export function parseSpec(raw: unknown): [number, number] | null {
  const parts = text(raw).split(/\s*[x×*]\s*/i);
  if (parts.length !== 2) return null;
  const w = num(parts[0]);
  const h = num(parts[1]);
  if (w === null || h === null || w <= 0 || h <= 0) return null;
  return [Math.round(w), Math.round(h)];
}

/** 헤더 행을 찾아 열 위치를 잡는다. 규격·수량이 둘 다 있어야 헤더로 본다 */
function findHeader(rows: unknown[][]): { rowIndex: number; cols: Partial<Record<ColumnKey, number>> } | null {
  const limit = Math.min(rows.length, 20);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? [];
    const cols: Partial<Record<ColumnKey, number>> = {};
    for (let c = 0; c < row.length; c++) {
      const cell = norm(row[c]);
      if (!cell) continue;
      for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
        if (cols[key] !== undefined) continue;
        if ((COLUMNS[key] as readonly string[]).some((name) => cell === norm(name))) {
          cols[key] = c;
        }
      }
    }
    if (cols.spec !== undefined && cols.quantity !== undefined) {
      return { rowIndex: r, cols };
    }
  }
  return null;
}

/**
 * 시트를 2차원 배열로 받아 품목·소계·합계를 뽑는다.
 *
 * 품명 병합 셀은 빈칸으로 들어오므로 위에서 물려받는다 — 발주서 파서와 같은 규칙.
 */
export function parseWorkOrderSheet(rows: unknown[][]): ParsedWorkOrder {
  const warnings: string[] = [];
  const header = findHeader(rows);

  if (!header) {
    return {
      items: [],
      printed_subtotals: [],
      printed_total: null,
      customer_label: null,
      warnings: ['작업의뢰서 표를 찾지 못했습니다. `규격` 과 `수량` 열이 있는 시트인지 확인하세요.'],
    };
  }

  const { cols } = header;
  const at = (row: unknown[], key: ColumnKey): unknown =>
    cols[key] === undefined ? null : row[cols[key]!];

  const items: WorkOrderItemInput[] = [];
  const printed_subtotals: ParsedWorkOrder['printed_subtotals'] = [];
  let printed_total: ParsedWorkOrder['printed_total'] = null;
  let customer_label: string | null = null;
  let inheritedName = '';

  for (let r = header.rowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((cell) => cell === null || cell === undefined || text(cell) === '')) continue;

    const label = norm(at(row, 'no'));
    const quantity = num(at(row, 'quantity'));
    const area = num(at(row, 'area'));

    // 소계 · 합계 — 품목이 아니라 검산용 숫자다
    if (label.includes('소계')) {
      const lastNo = items.length ? items[items.length - 1].no : 0;
      if (quantity !== null && area !== null) {
        printed_subtotals.push({ after_no: lastNo, quantity, area_m2: area });
      }
      continue;
    }
    if (label.includes('합계') || label.includes('총계')) {
      if (quantity !== null && area !== null) {
        printed_total = { quantity, area_m2: area };
      }
      continue;
    }

    const spec = parseSpec(at(row, 'spec'));
    const no = num(at(row, 'no'));

    // 품명은 병합 셀이라 비어 있으면 위에서 물려받는다
    const written = text(at(row, 'product'));
    if (written) inheritedName = written;

    if (!customer_label) {
      const c = text(at(row, 'customer'));
      if (c) customer_label = c;
    }

    if (spec === null || quantity === null) {
      // 머리글 아래 안내문 같은 줄은 조용히 넘기고, 품목처럼 보이는 줄만 알린다
      if (no !== null) {
        warnings.push(`${r + 1}행 — 규격이나 수량을 읽지 못해 건너뛰었습니다.`);
      }
      continue;
    }

    items.push({
      no: no ?? items.length + 1,
      product_name: inheritedName,
      width_mm: spec[0],
      height_mm: spec[1],
      quantity,
      // 면적은 ERP 가 적어 준 값을 그대로 쓴다 (최소 3재 같은 규칙이 이미 반영돼 있다)
      area_m2: area ?? 0,
      remark: text(at(row, 'remark')) || null,
    });
  }

  return { items, printed_subtotals, printed_total, customer_label, warnings };
}
