/**
 * (복층유리) 생산일지 — 회사가 손으로 쓰던 "복층생산일지(2026).xlsx" 하루치 시트를 시스템 기록으로 채운다.
 *
 * 2026-10-30 사용자 요청: 일간 생산일지가 회사 복층생산일지와 같은 모양으로 나오고,
 * **종류 · 수량외** 두 칸만 사람이 입력한다. 나머지는 생산 기록에서 채운다.
 *
 * 회사 양식에서 확인한 규칙 (5월 16일 시트 기준, 주간생산일지 1호기 346조 · 337.14㎡ 와 대조):
 *  · 한 줄 = 그날 한 호기에서 만든 **주문 하나의 재료 구성 하나**. 같은 주문의 두 번째 재료 줄은 주문번호 · 거래처를 비운다.
 *  · 위 덩어리 = 1호기, 아래 덩어리 = 2호기. 덩어리마다 소계.
 *  · 수량외 "16조외52" = 앞의 크기 16조 + 다른 크기 52조 → 수량 68조. 사람이 적는다 (회사도 '외' 처리를 아직 정하는 중).
 *  · 제품 두께 = 재료 숫자의 합(5+12+5=22), AR = 간봉 자리에 Ar 이 있을 때.
 *  · 수량(평) K 열 = ㎡(M 열) × 10.89 — 실제로는 재(才) 단위다. 회사 수식 `=+M*N` 을 그대로 쓴다.
 *  · 맨 아래 종류별 합계는 종류 칸을 SUMIF 한다. B종(U3-2) 칸이 "U3" 를 센다 — 회사 수식 그대로.
 *  · 누계는 회사 파일에서 1월부터 5월까지 같은 값이 복사돼 있어(관리 안 됨) 시스템 기록의 올해 누계로 채운다.
 */
import type { ProductionLogRow } from './daily-report';
import { DEFAULT_LINES, lineName, type ProductionLine } from './lines';

/** ㎡ → 재(才). 회사 양식 N 열의 값 (3.3 × 3.3) */
export const JAE_PER_M2 = 10.89;

/** 사람이 입력하는 두 칸 */
export interface BokcheungEntry {
  /** 종류 — U1 · U2 · U3 · U3-1 · E5 */
  glass_type: string;
  /** 수량외 — "16조외52" 처럼 */
  quantity_note: string;
}

/** 종류 칸에 고를 수 있는 값 (회사 합계 칸의 SUMIF 조건) */
export const GLASS_TYPES = ['U1', 'U2', 'U3', 'U3-1', 'E5'] as const;

/** 맨 아래 종류별 합계 — 이름표와 회사 수식의 SUMIF 조건 */
export const SUMMARY_COLUMNS = [
  { label: 'A종(U1)', match: 'U1' },
  { label: 'A종(U2)', match: 'U2' },
  { label: 'B종(U3-1)', match: 'U3-1' },
  { label: 'B종(U3-2)', match: 'U3' },
  { label: 'C종 (E5)', match: 'E5' },
] as const;

export interface ParsedProduct {
  /** 재료종류 칸 — 앞의 두께 표기(24T)를 뗀 구성 */
  composition: string;
  /** 제품 두께 (mm). 앞 표기가 없으면 재료 숫자의 합 */
  thickness: number | null;
  /** 간봉 자리에 Ar(아르곤)이 있나 */
  argon: boolean;
  /** 유리가 둘 이상 겹친 복층 · 3복층인가 — 단판(10T 투명강화 등)은 복층 일지에 넣지 않는다 */
  insulated: boolean;
}

/**
 * ERP 품명 → 복층생산일지 칸.
 *   "24T 5SKN176IIh/s+14단열(Ar.)+5CLh/s" → 재료 "5SKN176IIh/s+14단열(Ar.)+5CLh/s", 두께 24, AR
 *   "22T 5newGN+12A+5로이" → 두께 22, AR 아님 (12A 는 공기)
 */
export function parseProductName(productName: string): ParsedProduct {
  const name = productName.trim();
  const head = name.match(/^(\d+(?:\.\d+)?)\s*T\s+(.*)$/i);
  const composition = (head ? head[2] : name).trim();
  const parts = composition.split('+').map(p => p.trim()).filter(Boolean);
  const insulated = parts.length >= 3;
  // 유리 · 간봉 · 유리 … 가 번갈아 온다 — 홀수 자리가 간봉
  const argon = insulated && parts.some((p, i) => i % 2 === 1 && /ar/i.test(p));
  let thickness: number | null = head ? Number(head[1]) : null;
  if (thickness === null && insulated) {
    const nums = parts.map(p => p.match(/^\d+(?:\.\d+)?/)?.[0]);
    if (nums.every(Boolean)) thickness = nums.reduce((s, n) => s + Number(n), 0);
  }
  return { composition, thickness, argon, insulated };
}

export interface BokcheungRow {
  /** 입력값을 붙이는 열쇠 — `${호기}|${작업의뢰서 id}|${재료종류}` */
  key: string;
  line: number;
  work_order_id: string;
  work_order_number: string;
  /** 거래처(발주자) 칸 — "업체 현장" */
  customer_site: string;
  composition: string;
  thickness: number | null;
  argon: boolean;
  /** 대표 크기 — 그날 이 줄에서 작업의뢰서 순서가 가장 앞인 품목 */
  width_mm: number | null;
  height_mm: number | null;
  /** 대표 크기로 만든 수량 */
  lead_quantity: number;
  /** 수량(조) */
  quantity: number;
  /** ㎡ — 회사 양식 M 열 */
  area_m2: number;
  /** 같은 주문의 두 번째 이후 재료 줄 — 주문번호 · 거래처 칸을 비운다 */
  continued: boolean;
  /** 수량외 제안 — 대표 크기 수량 + 나머지 */
  suggested_note: string;
}

export interface BokcheungBlock {
  /** 호기 번호 */
  line: number;
  /** 호기 이름 (화면용 — 회사 양식에는 덩어리 이름이 없다) */
  name: string;
  rows: BokcheungRow[];
  quantity: number;
  area_m2: number;
}

export interface BokcheungSheet {
  date: string;
  /**
   * 양식의 두 덩어리 — 1호기, 2호기 (늘 있다). 호기를 더했으면(미니라인 등) 그 호기에 생산이 있는 날만
   * 덩어리를 뒤에 덧붙인다 (2026-10-30 회의 "호기 편집").
   */
  blocks: BokcheungBlock[];
  /** 복층이 아니어서 빠진 품목 (단판 강화 등) */
  excluded: { quantity: number; names: string[] };
  /** 올해 1월 1일부터 이날까지 — 시스템에 기록된 복층만 */
  cumulative: { quantity: number; area_m2: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 수량외 제안 — 대표 크기만 있으면 그 수, 아니면 "16조외52" */
export function suggestQuantityNote(lead: number, total: number): string {
  return lead >= total ? String(total) : `${lead}조외${total - lead}`;
}

export function rowKey(line: number, workOrderId: string, composition: string): string {
  return `${line}|${workOrderId}|${composition}`;
}

interface Group {
  line: number;
  work_order_id: string;
  work_order_number: string;
  customer: string;
  site: string;
  parsed: ParsedProduct;
  quantity: number;
  area: number;
  firstSort: number;
  /** 품목별 — 대표 크기 고르기 */
  items: Map<string, { sort: number; width: number | null; height: number | null; quantity: number; seq: number }>;
}

/**
 * 하루치 생산 기록 → 복층생산일지 두 덩어리.
 * logs 는 그날(date) 기록만 넘긴다. cumulative 는 따로 구해 넘긴다 (cumulativeOf).
 */
export function buildBokcheungSheet(
  logs: ProductionLogRow[], date: string, cumulative: { quantity: number; area_m2: number },
  lines: ProductionLine[] = DEFAULT_LINES,
): BokcheungSheet {
  const groups = new Map<string, Group>();
  const excluded = { quantity: 0, names: [] as string[] };
  let seq = 0;

  for (const log of logs) {
    if (log.production_date !== date) continue;
    const parsed = parseProductName(log.product_name);
    if (!parsed.insulated || !log.work_order_item_id) {
      excluded.quantity += log.quantity_completed;
      if (!excluded.names.includes(log.product_name)) excluded.names.push(log.product_name);
      continue;
    }
    const line = log.line_number && log.line_number > 0 ? log.line_number : 1;
    const key = rowKey(line, log.work_order_id, parsed.composition);
    let g = groups.get(key);
    if (!g) {
      g = {
        line, work_order_id: log.work_order_id, work_order_number: log.work_order_number,
        customer: log.customer ?? '', site: log.site ?? '', parsed,
        quantity: 0, area: 0, firstSort: Number.POSITIVE_INFINITY, items: new Map(),
      };
      groups.set(key, g);
    }
    g.quantity += log.quantity_completed;
    g.area += Number(log.area_m2 || 0);
    const sort = log.sort_order ?? Number.MAX_SAFE_INTEGER;
    g.firstSort = Math.min(g.firstSort, sort);
    const item = g.items.get(log.work_order_item_id)
      ?? { sort, width: log.width_mm, height: log.height_mm, quantity: 0, seq: seq++ };
    item.quantity += log.quantity_completed;
    g.items.set(log.work_order_item_id, item);
  }

  // 덩어리 순서 — 1 · 2호기는 늘, 더한 호기는 그날 생산이 있을 때만 (호기 목록 순서대로)
  const order = (n: number) => {
    const i = lines.findIndex(l => l.line_number === n);
    return i < 0 ? 1000 + n : i;
  };
  const used = new Set([...groups.values()].map(g => g.line));
  const lineNumbers = [...new Set([1, 2, ...used])].sort((a, b) => (a <= 2 || b <= 2 ? a - b : order(a) - order(b)));

  const blocks = lineNumbers.map(line => {
    const mine = [...groups.entries()]
      .filter(([, g]) => g.line === line)
      // 주문번호 순 → 같은 주문 안에서는 작업의뢰서 순서
      .sort(([, a], [, b]) => a.work_order_number.localeCompare(b.work_order_number) || a.firstSort - b.firstSort);
    const rows: BokcheungRow[] = mine.map(([key, g], i) => {
      const lead = [...g.items.values()].sort((a, b) => a.sort - b.sort || a.seq - b.seq)[0];
      const prev = mine[i - 1]?.[1];
      return {
        key,
        line,
        work_order_id: g.work_order_id,
        work_order_number: g.work_order_number,
        customer_site: [g.customer, g.site].filter(Boolean).join(' '),
        composition: g.parsed.composition,
        thickness: g.parsed.thickness,
        argon: g.parsed.argon,
        width_mm: lead?.width ?? null,
        height_mm: lead?.height ?? null,
        lead_quantity: lead?.quantity ?? 0,
        quantity: g.quantity,
        area_m2: round2(g.area),
        continued: prev?.work_order_id === g.work_order_id,
        suggested_note: suggestQuantityNote(lead?.quantity ?? 0, g.quantity),
      };
    });
    return {
      line,
      name: lineName(lines, line),
      rows,
      quantity: rows.reduce((s, r) => s + r.quantity, 0),
      area_m2: round2(rows.reduce((s, r) => s + r.area_m2, 0)),
    };
  });

  return { date, blocks, excluded, cumulative };
}

/** 복층만 더한 수량 · 면적 (반올림 전) */
function insulatedTotals(logs: Pick<ProductionLogRow, 'product_name' | 'quantity_completed' | 'area_m2'>[]) {
  let quantity = 0;
  let area = 0;
  for (const l of logs) {
    if (!parseProductName(l.product_name).insulated) continue;
    quantity += l.quantity_completed;
    area += Number(l.area_m2 || 0);
  }
  return { quantity, area };
}

/** 누계 — 넘겨받은 기록 중 복층만 더한다 (기간은 부르는 쪽이 고른다) */
export function cumulativeOf(logs: Pick<ProductionLogRow, 'product_name' | 'quantity_completed' | 'area_m2'>[]) {
  const t = insulatedTotals(logs);
  return { quantity: t.quantity, area_m2: round2(t.area) };
}

/**
 * 기간 → 날짜별 복층생산일지 (회사 파일처럼 하루 한 시트). 복층 줄이 있는 날만 만든다.
 * logs 는 from 이 속한 해 1월 1일부터 to 까지 넘긴다 — 날짜마다 그해 1월 1일부터의 누계를 낸다(해가 바뀌면 새로 센다).
 * 2026-10-30 요청: "기간으로 뽑을 때도 복층생산일지가 날짜별 시트로 — 5/16 뒤 것을 회사 파일에 넣어 합치게".
 */
export function buildBokcheungRange(
  logs: ProductionLogRow[], from: string, to: string, lines: ProductionLine[] = DEFAULT_LINES,
): BokcheungSheet[] {
  const byDate = new Map<string, ProductionLogRow[]>();
  for (const l of logs) {
    const list = byDate.get(l.production_date) ?? [];
    list.push(l);
    byDate.set(l.production_date, list);
  }
  const sheets: BokcheungSheet[] = [];
  let year = '';
  let quantity = 0;
  let area = 0;
  for (const date of [...byDate.keys()].sort()) {
    if (date.slice(0, 4) !== year) { year = date.slice(0, 4); quantity = 0; area = 0; }
    const day = byDate.get(date)!;
    const t = insulatedTotals(day);
    quantity += t.quantity;
    area += t.area;
    if (date < from || date > to) continue;
    const sheet = buildBokcheungSheet(day, date, { quantity, area_m2: round2(area) }, lines);
    if (sheet.blocks.some(b => b.rows.length > 0)) sheets.push(sheet);
  }
  return sheets;
}

/** 종류별 합계 — 회사 수식처럼 SUMIF (대소문자 무시, 칸 전체가 같아야 센다) */
export function summarizeTypes(sheet: BokcheungSheet, entries: Record<string, BokcheungEntry | undefined>) {
  const rows = sheet.blocks.flatMap(b => b.rows);
  const counts = SUMMARY_COLUMNS.map(c => rows
    .filter(r => (entries[r.key]?.glass_type ?? '').trim().toUpperCase() === c.match)
    .reduce((s, r) => s + r.quantity, 0));
  return { counts, total: counts.reduce((s, n) => s + n, 0) };
}

/** 수량외 칸 값 — 숫자만 쓰면 숫자로(회사 파일의 "1"), 아니면 글자 그대로 */
export function quantityNoteCell(note: string | undefined): string | number | null {
  const t = (note ?? '').trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : t;
}
