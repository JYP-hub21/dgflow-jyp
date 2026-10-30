/**
 * ERP 작업의뢰서 목록 엑셀 읽기 — 지난 작업의뢰서를 한꺼번에 가져올 때.
 *
 * 회사가 ERP 에서 뽑아 준 "20260911 AX 업로드.xlsx" 꼴: 한 줄 = 작업의뢰서 품목 하나.
 *   주문번호 · 주문일자 · 납품일자 · 거래처 · 현장명 · 구분 · 품명 · 두께 · 가로규격 · 세로규격 ·
 *   주문수량 · 출고수량 · 잔여수량 · 면적 · 미출고액 · 비고 · ID · 의뢰번호 · NO
 * 의뢰서 한 장씩 올리는 길(엑셀 + PDF)과 달리 이 파일 하나에 머리글(거래처 · 현장 · 날짜)까지 다 있어 PDF 가 필요 없다.
 *
 * 칸은 순서가 아니라 머리 이름으로 찾는다 (ERP 가 칸 순서를 바꿔도 읽히게).
 * 확실하지 않은 줄(의뢰번호 · 품명 · 규격 · 수량이 비거나 숫자가 아님)은 넣지 않고 따로 알린다 — 추측으로 채우지 않는다.
 */
import { expectedArea } from './verify';

export interface ErpListItem {
  /** 의뢰서 안 순번 (NO) */
  no: number;
  /** 시스템 품명 — 두께를 앞에 붙인 ERP 꼴 "24T 5SKN154IIh/s+14단열(Ar.)+5CL" */
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  /** 출고수량 */
  shipped: number;
  /** 잔여수량 (칸이 없으면 수량 - 출고) */
  remaining: number;
  remark: string;
  /** ㎡ — ERP 규칙(장당 최소 0.28㎡)으로 계산. 파일의 면적 칸은 재(才) 정수라 쓰지 않는다 */
  area_m2: number;
}

export interface ErpListOrder {
  work_order_number: string;
  /** ERP 주문번호 (260102-01 꼴) — 메모로 남긴다 */
  erp_order_number: string;
  customer: string;
  site: string;
  request_date: string | null;
  delivery_date: string | null;
  items: ErpListItem[];
  quantity: number;
  shipped: number;
  remaining: number;
}

export interface ErpListParse {
  orders: ErpListOrder[];
  /** 읽은 품목 줄 수 (넣을 수 있는 것) */
  itemCount: number;
  /** 넣지 않은 줄 — 엑셀 줄 번호(1부터)와 까닭 */
  skipped: { row: number; reason: string }[];
  /** 머리 줄 번호(1부터). 못 찾으면 0 */
  headerRow: number;
  /** 못 찾은 필수 칸 */
  missingColumns: string[];
}

/** 칸 머리 이름 후보 — 띄어쓰기는 무시하고 비교한다 */
const HEADERS = {
  work_order_number: ['의뢰번호'],
  erp_order_number: ['주문번호'],
  request_date: ['주문일자', '의뢰일자'],
  delivery_date: ['납품일자', '납기일자', '납기'],
  customer: ['거래처', '업체명'],
  site: ['현장명', '현장'],
  product: ['품명'],
  thickness: ['두께'],
  width: ['가로규격', '가로'],
  height: ['세로규격', '세로'],
  quantity: ['주문수량', '수량'],
  shipped: ['출고수량'],
  remaining: ['잔여수량'],
  remark: ['비고'],
  no: ['NO', 'No', '순번'],
} as const;
type Col = keyof typeof HEADERS;
const REQUIRED: Col[] = ['work_order_number', 'product', 'width', 'height', 'quantity'];
const LABEL: Record<Col, string> = {
  work_order_number: '의뢰번호', erp_order_number: '주문번호', request_date: '주문일자', delivery_date: '납품일자',
  customer: '거래처', site: '현장명', product: '품명', thickness: '두께', width: '가로규격', height: '세로규격',
  quantity: '주문수량', shipped: '출고수량', remaining: '잔여수량', remark: '비고', no: 'NO',
};

const norm = (v: unknown) => String(v ?? '').replace(/\s/g, '');
const text = (v: unknown) => String(v ?? '').trim();

/** "1,326 " · 1326 · "" → 숫자 (없거나 숫자가 아니면 null) */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 날짜 칸 → 'YYYY-MM-DD'. Date · 엑셀 일련번호 · "2026-01-02" · "2026.1.2" · "1/2/26"(월/일/연) */
export function toIsoDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // 시간대에 흔들리지 않게 12시간을 더해 날짜만 읽는다
    return new Date(v.getTime() + 12 * 3600_000).toISOString().slice(0, 10);
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  }
  const s = text(v);
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

/** 품명 + 두께 → "24T 품명". 품명이 이미 "24T " 로 시작하면 그대로 */
export function productNameOf(product: string, thickness: number | null): string {
  if (/^\d+(\.\d+)?\s*T\s/i.test(product) || thickness == null || thickness <= 0) return product;
  return `${thickness}T ${product}`;
}

export function parseErpOrderList(rows: unknown[][]): ErpListParse {
  // 머리 줄 — 위 20줄 안에서 의뢰번호 · 품명이 함께 있는 줄
  let headerIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] ?? []).map(norm);
    if (cells.includes('의뢰번호') && cells.includes('품명')) { headerIndex = i; break; }
  }
  if (headerIndex < 0) {
    return { orders: [], itemCount: 0, skipped: [], headerRow: 0, missingColumns: REQUIRED.map(c => LABEL[c]) };
  }

  const header = (rows[headerIndex] ?? []).map(norm);
  const col = {} as Record<Col, number>;
  for (const key of Object.keys(HEADERS) as Col[]) {
    col[key] = header.findIndex(h => (HEADERS[key] as readonly string[]).some(name => norm(name) === h));
  }
  const missingColumns = REQUIRED.filter(c => col[c] < 0).map(c => LABEL[c]);
  if (missingColumns.length > 0) {
    return { orders: [], itemCount: 0, skipped: [], headerRow: headerIndex + 1, missingColumns };
  }

  const get = (row: unknown[], key: Col) => (col[key] >= 0 ? row[col[key]] : undefined);
  const orders = new Map<string, ErpListOrder & { seq: number[] }>();
  const skipped: ErpListParse['skipped'] = [];
  let itemCount = 0;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (row.every(c => text(c) === '')) continue;
    const excelRow = i + 1;
    const number = text(get(row, 'work_order_number'));
    const product = text(get(row, 'product'));
    const width = toNumber(get(row, 'width'));
    const height = toNumber(get(row, 'height'));
    const quantity = toNumber(get(row, 'quantity'));
    if (!number) { skipped.push({ row: excelRow, reason: '의뢰번호가 비어 있음' }); continue; }
    if (!product) { skipped.push({ row: excelRow, reason: `${number} · 품명이 비어 있음` }); continue; }
    if (!width || !height || width <= 0 || height <= 0) { skipped.push({ row: excelRow, reason: `${number} · 가로 · 세로가 숫자가 아님` }); continue; }
    if (!quantity || quantity <= 0 || !Number.isInteger(quantity)) { skipped.push({ row: excelRow, reason: `${number} · 수량이 올바르지 않음` }); continue; }

    const shipped = Math.max(0, Math.min(quantity, toNumber(get(row, 'shipped')) ?? 0));
    const remainingCol = toNumber(get(row, 'remaining'));
    const remaining = remainingCol != null ? Math.max(0, remainingCol) : quantity - shipped;
    const item: ErpListItem = {
      no: toNumber(get(row, 'no')) ?? 0,
      product_name: productNameOf(product, toNumber(get(row, 'thickness'))),
      width_mm: Math.round(width),
      height_mm: Math.round(height),
      quantity,
      shipped,
      remaining,
      remark: text(get(row, 'remark')),
      area_m2: expectedArea(Math.round(width), Math.round(height), quantity),
    };

    let order = orders.get(number);
    if (!order) {
      order = {
        work_order_number: number,
        erp_order_number: text(get(row, 'erp_order_number')),
        customer: text(get(row, 'customer')),
        site: text(get(row, 'site')),
        request_date: toIsoDate(get(row, 'request_date')),
        delivery_date: toIsoDate(get(row, 'delivery_date')),
        items: [], quantity: 0, shipped: 0, remaining: 0, seq: [],
      };
      orders.set(number, order);
    }
    order.items.push(item);
    order.seq.push(i);
    order.quantity += quantity;
    order.shipped += shipped;
    order.remaining += remaining;
    itemCount++;
  }

  // 의뢰서 안 순서 — NO 가 있으면 NO, 없으면 엑셀 줄 순서. 의뢰서끼리는 의뢰번호 순 (파일은 뒤섞여 있기도 하다)
  const list = [...orders.values()].map(({ seq, ...o }) => {
    const order = o.items.map((it, k) => ({ it, k: seq[k] }));
    order.sort((a, b) => (a.it.no && b.it.no ? a.it.no - b.it.no : a.k - b.k));
    return { ...o, items: order.map(x => x.it) };
  }).sort((a, b) => a.work_order_number.localeCompare(b.work_order_number, 'ko', { numeric: true }));

  return { orders: list, itemCount, skipped, headerRow: headerIndex + 1, missingColumns: [] };
}

/** 가져올 때 정하는 두 가지 */
export interface ImportOptions {
  /** 출고된 수량만큼은 생산 완료로 넣는다 */
  producedFromShipped: boolean;
  /** 잔여가 남은 의뢰서 — 진행 중으로 띄울지(active), 완료로 보관할지(archive) */
  remainingStatus: 'active' | 'archive';
}

/** 의뢰서 상태와 품목별 생산 수량 — 화면 미리보기와 서버 저장이 같은 규칙을 쓴다 */
export function importPlan(order: Pick<ErpListOrder, 'items'>, options: ImportOptions) {
  const produced = order.items.map(it => (options.producedFromShipped ? Math.min(it.shipped, it.quantity) : 0));
  const left = order.items.reduce((s, it, k) => s + (it.quantity - produced[k]), 0);
  const anyProduced = produced.some(n => n > 0);
  const status: 'pending' | 'in_progress' | 'completed' =
    left === 0 || options.remainingStatus === 'archive' ? 'completed' : anyProduced ? 'in_progress' : 'pending';
  return { produced, status };
}
