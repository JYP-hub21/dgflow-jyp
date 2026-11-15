/**
 * MES 생산실적 → 생산 기록 (2026-11-13 이사님 요청).
 *
 * MES 의 포장공정 바코드 기록(한 줄 = 복층유리 한 장)을 의뢰번호 + NO 로 작업의뢰서 품목에 맞춰
 * 날짜 · 호기별 생산 기록으로 넣는다. 생산관리부 담당자가 생산 입력을 손으로 하지 않게 하려는 것.
 * 생산 기록이 들어가면 일간 · 복층 · 주간 생산일지는 원래대로 그 기록에서 계산된다.
 *
 * 규칙
 *  - 같은 바코드(PID)가 두 번 찍혔으면 한 번만 센다.
 *  - 같은 품목 · 같은 날 · 같은 호기에 이미 들어간 생산 기록(손 입력 포함)은 빼고 모자란 만큼만 넣는다.
 *    그래서 같은 파일을 두 번 올려도 두 번 들어가지 않는다.
 *  - 의뢰 수량을 넘게 넣지 않는다 (재작업 등으로 더 찍힌 것은 '확인 필요' 로 보여 준다).
 *  - 규격(가로 · 세로)이 품목과 다르면 넣지 않는다 — NO 가 엇갈렸을 수 있다.
 *  - 주간/야간은 아직 정하지 않아 모두 주간으로 넣는다 (2026-11-13 사용자: "일단 올 주간으로").
 *
 * 이 파일은 화면(미리보기)과 서버(등록)가 함께 쓴다 — 서버는 화면이 보낸 계산을 믿지 않고 다시 계산한다.
 */
import { serialToIsoDate, type CellValue } from '@/lib/excel/xlsx-rows';

/**
 * 등록(생산 기록에 실제로 넣기) 잠금 — 2026-11-13 사용자: "실험만 하고 아직 화면에 자동으로 채우진 마".
 * 미리보기만 된다. 사용자가 허락하면 true 로 바꾼다 (서버 · 화면이 함께 본다).
 */
export const MES_COMMIT_ENABLED = false;

/** 생산 기록 비고 — MES 에서 들어온 기록 표시 */
export const MES_REMARK = 'MES 바코드';

export type MesShift = 'day' | 'night';

/**
 * 야간이 시작되는 시각(자정부터 분) — 2026-11-13 회의(생산관리부):
 * 오전 8:30–12:30 · 오후 13:30–17:30 · 석식 30분 · 야간 18:00–21:00.
 * 석식 시간(17:30–18:00)에 찍힌 바코드는 주간 끝 작업으로 본다 (2026 MES 자료: 17:30–17:59 781장, 18시대부터 다시 늘어난다).
 * 시각을 바꾸면 이 값만 고친다.
 */
export const NIGHT_FROM_MINUTES = 18 * 60;

/** 엑셀 시각 칸 → 자정부터 분. 일련번호(소수 부분) · Date · "18:05" · "2026-10-22 18:05" 글자. 모르면 null */
export function minutesOfDay(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const frac = v - Math.floor(v);
    return Math.round(frac * 1440) % 1440;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getHours() * 60 + v.getMinutes();
  const m = /(?:^|\s|T)(\d{1,2}):(\d{2})/.exec(String(v ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** 주간 · 야간 — 시각을 모르면 주간 */
export function shiftOf(minutes: number | null): MesShift {
  return minutes !== null && minutes >= NIGHT_FROM_MINUTES ? 'night' : 'day';
}

export const SHIFT_TEXT: Record<MesShift, string> = { day: '주간', night: '야간' };

export interface MesPiece {
  /** 시스템 의뢰번호 꼴 "26-2573" */
  wo: string;
  no: number;
  /** 생산일 YYYY-MM-DD */
  date: string;
  /** 1 · 2호기, 알 수 없으면 0 */
  line: number;
  /** 바코드를 찍은 시각으로 가른 주간 · 야간 (NIGHT_FROM_MINUTES) */
  shift: MesShift;
  qty: number;
  product: string;
  width: number;
  height: number;
  customer: string;
  site: string;
  remark: string;
}

export interface MesSkip {
  reason: string;
  count: number;
  /** 엑셀 줄 번호 몇 개 */
  rows: number[];
}

export interface MesParse {
  pieces: MesPiece[];
  /** 같은 바코드가 다시 찍혀 뺀 장수 */
  duplicates: number;
  skipped: MesSkip[];
  sheet: string;
}

/** 칸 머리 이름 후보 — 띄어쓰기 · 마침표는 무시하고 비교 */
const HEADERS = {
  wo: ['의뢰번호'],
  no: ['NO', '번호'],
  date: ['일자', '생산일자'],
  registeredAt: ['등록일시'],
  time: ['시간', '등록시간'],
  line: ['라인', '호기'],
  pid: ['PID', '바코드'],
  qty: ['수량'],
  product: ['품명'],
  width: ['가로'],
  height: ['세로'],
  customer: ['거래처'],
  site: ['현장', '현장명'],
  remark: ['비고'],
} as const;

export type MesColumns = Partial<Record<keyof typeof HEADERS, number>>;
const REQUIRED: (keyof typeof HEADERS)[] = ['wo', 'no', 'line'];

const norm = (v: unknown) => String(v ?? '').replace(/[\s.]/g, '').toUpperCase();

/** 머리 줄이면 칸 위치, 아니면 null (의뢰번호 · NO · 라인 · 날짜가 있어야 한다) */
export function mesHeader(row: unknown[]): MesColumns | null {
  const cols: MesColumns = {};
  row.forEach((v, i) => {
    const key = norm(v);
    for (const [field, names] of Object.entries(HEADERS) as [keyof typeof HEADERS, readonly string[]][]) {
      if (cols[field] === undefined && names.some(n => norm(n) === key)) cols[field] = i;
    }
  });
  if (REQUIRED.some(f => cols[f] === undefined)) return null;
  if (cols.date === undefined && cols.registeredAt === undefined) return null;
  return cols;
}

/** 빠진 필수 칸 이름 (머리 줄을 못 찾았을 때 안내용) */
export function mesMissingColumns(row: unknown[]): string[] {
  const keys = new Set(row.map(norm));
  const miss: string[] = [];
  if (!keys.has('의뢰번호')) miss.push('의뢰번호');
  if (!keys.has('NO') && !keys.has('번호')) miss.push('NO.');
  if (!keys.has('라인') && !keys.has('호기')) miss.push('라인');
  if (!['일자', '생산일자', '등록일시'].some(k => keys.has(k))) miss.push('일자');
  return miss;
}

/** "26-2573" · "2026-0388" · "26-2463★" → "26-2573" 꼴. 알아볼 수 없으면 null */
export function normalizeWorkOrderNumber(raw: unknown): string | null {
  const s = String(raw ?? '').trim().replace(/[^\d-]/g, '');
  const long = /^20(\d{2})-(\d{1,5})$/.exec(s);
  if (long) return `${long[1]}-${long[2]}`;
  return /^\d{2}-\d{1,5}$/.test(s) ? s : null;
}

/** "1-LINE" · "2-LINE" · "1호기" → 1 · 2. 모르면 0 */
export function parseLine(raw: unknown): number {
  const m = /([12])/.exec(String(raw ?? ''));
  return m ? Number(m[1]) : 0;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 날짜 칸 → YYYY-MM-DD (엑셀 일련번호 · Date · "2026-10-22" · "2026.10.22" 글자) */
export function toIsoDate(v: unknown, date1904 = false): string | null {
  if (typeof v === 'number') return serialToIsoDate(v, date1904);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(String(v ?? '').trim());
  return m ? `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}` : null;
}

/** 비고 — 날짜를 적은 칸이 엑셀 일련번호(46035)로 바뀐 것은 날짜로 되돌린다 */
function remarkText(v: unknown, date1904: boolean): string {
  if (typeof v === 'number') return v > 36_000 && v < 60_000 ? serialToIsoDate(v, date1904) ?? String(v) : String(v);
  return text(v);
}

const text = (v: unknown) => (v === undefined || v === null || v === 0 ? '' : String(v).trim());
const int = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

/**
 * 줄들을 한 장씩 모은다. 줄은 하나씩 넣어(add) 큰 파일도 한 번에 들고 있지 않게 한다.
 * 머리 줄을 만나기 전 줄은 버린다.
 */
export class MesCollector {
  private cols: MesColumns | null = null;
  private seen = new Set<string>();
  private skips = new Map<string, MesSkip>();
  private firstRows: unknown[][] = [];
  pieces: MesPiece[] = [];
  duplicates = 0;

  constructor(private date1904 = false) {}

  get headerFound() { return this.cols !== null; }

  /** 머리를 못 찾았을 때 앞 줄들에서 빠진 칸 */
  missingColumns(): string[] {
    const best = this.firstRows.map(mesMissingColumns).sort((a, b) => a.length - b.length)[0];
    return best ?? ['의뢰번호', 'NO.', '라인', '일자'];
  }

  private skip(reason: string, row: number) {
    const s = this.skips.get(reason) ?? { reason, count: 0, rows: [] };
    s.count++;
    if (s.rows.length < 5) s.rows.push(row);
    this.skips.set(reason, s);
  }

  add(cells: (CellValue | undefined)[] | unknown[], rowNumber: number) {
    const c = this.cols;
    if (!c) {
      if (this.firstRows.length < 20) this.firstRows.push(cells as unknown[]);
      this.cols = mesHeader(cells as unknown[]);
      return;
    }
    const at = (k: keyof MesColumns) => (c[k] === undefined ? undefined : (cells as unknown[])[c[k]!]);
    const rawWo = at('wo');
    const pid = text(at('pid'));
    // 바코드도 의뢰번호도 없는 줄은 빈 줄이다 (Data 시트 아래쪽에 수식만 남은 빈 줄이 18만 개 있다)
    if (!text(rawWo) && !pid) return;
    const wo = normalizeWorkOrderNumber(rawWo);
    if (!wo) { this.skip(`의뢰번호를 알아볼 수 없음 (${text(rawWo) || '빈칸'})`, rowNumber); return; }
    const no = int(at('no'));
    if (!Number.isInteger(no) || no <= 0) { this.skip('NO. 가 비었거나 숫자가 아님', rowNumber); return; }
    const date = toIsoDate(at('date'), this.date1904) ?? toIsoDate(at('registeredAt'), this.date1904);
    if (!date) { this.skip('일자를 알아볼 수 없음', rowNumber); return; }
    if (pid) {
      if (this.seen.has(pid)) { this.duplicates++; return; }
      this.seen.add(pid);
    }
    const qtyRaw = c.qty === undefined ? 1 : int(at('qty'));
    // 시각 — 등록일시의 시각이 먼저, 없으면 시간 칸
    const minutes = minutesOfDay(at('registeredAt')) ?? minutesOfDay(at('time'));
    this.pieces.push({
      wo, no, date,
      line: parseLine(at('line')),
      shift: shiftOf(minutes),
      qty: Number.isInteger(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1,
      product: text(at('product')),
      width: int(at('width')) || 0,
      height: int(at('height')) || 0,
      customer: text(at('customer')),
      site: text(at('site')),
      remark: remarkText(at('remark'), this.date1904),
    });
  }

  result(sheet: string): MesParse {
    return { pieces: this.pieces, duplicates: this.duplicates, skipped: [...this.skips.values()], sheet };
  }
}

/** 날짜 · 호기 · 품목별로 묶은 MES 장수 */
export interface MesGroup {
  wo: string;
  no: number;
  date: string;
  line: number;
  shift: MesShift;
  count: number;
  product: string;
  width: number;
  height: number;
  customer: string;
  site: string;
  remark: string;
}

/** 기간(양 끝 포함) 안의 장을 품목 · 날짜 · 호기 · 주야간으로 묶는다. 의뢰번호 · NO · 날짜 · 호기 · 주야간 순 */
export function groupPieces(pieces: MesPiece[], from?: string, to?: string): MesGroup[] {
  const map = new Map<string, MesGroup>();
  for (const p of pieces) {
    if ((from && p.date < from) || (to && p.date > to)) continue;
    const key = `${p.wo}|${p.no}|${p.date}|${p.line}|${p.shift}`;
    const g = map.get(key);
    if (g) g.count += p.qty;
    else map.set(key, { wo: p.wo, no: p.no, date: p.date, line: p.line, shift: p.shift, count: p.qty, product: p.product, width: p.width, height: p.height, customer: p.customer, site: p.site, remark: p.remark });
  }
  return [...map.values()].sort(compareGroups);
}

export function compareGroups(a: { wo: string; no: number; date: string; line: number; shift?: MesShift }, b: typeof a): number {
  return a.wo.localeCompare(b.wo) || a.no - b.no || a.date.localeCompare(b.date) || a.line - b.line
    || (a.shift === b.shift ? 0 : a.shift === 'night' ? 1 : -1);
}

/** 시스템의 작업의뢰서 · 품목 · 이미 들어간 생산 기록 */
export interface MesDbItem {
  id: string;
  /** 종이 의뢰서의 NO (없으면 sort_order + 1) */
  no: number;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  area_m2: number | string | null;
  logs: { date: string; line: number; shift: MesShift; qty: number }[];
}

export interface MesDbOrder {
  id: string;
  work_order_number: string;
  production_site: string;
  items: MesDbItem[];
}

export type MesStatus =
  | 'add'       // 넣는다
  | 'partial'   // 의뢰 수량까지만 일부 넣는다
  | 'done'      // 이미 들어가 있다
  | 'over'      // 의뢰 수량이 이미 다 차서 넣지 않는다
  | 'no-order'  // 작업의뢰서가 시스템에 없다
  | 'no-item'   // 의뢰서에 그 NO 품목이 없다
  | 'size'      // 규격이 품목과 다르다
  | 'line';     // 호기를 알 수 없다

export interface MesPlanRow extends MesGroup {
  status: MesStatus;
  /** 이번에 넣을 수량 */
  add: number;
  /** 이 날 · 호기 · 주야간에 이미 들어간 수량 */
  already: number;
  workOrderId?: string;
  itemId?: string;
  itemQuantity?: number;
  itemProduct?: string;
  itemWidth?: number;
  itemHeight?: number;
  outsource?: boolean;
}

/** 가로 · 세로가 같은지 (돌려 적은 것도 같다고 본다). MES 규격이 비어 있으면 따지지 않는다 */
function sameSize(g: MesGroup, it: MesDbItem): boolean {
  if (!g.width || !g.height) return true;
  return (g.width === it.width_mm && g.height === it.height_mm) || (g.width === it.height_mm && g.height === it.width_mm);
}

/**
 * 넣을 계획 — 품목마다 날짜 · 호기 순으로 모자란 만큼, 의뢰 수량을 넘지 않게.
 * orders 는 의뢰번호 → 시스템 의뢰서 (없으면 미등록).
 */
export function planMesImport(groups: MesGroup[], orders: Map<string, MesDbOrder>): MesPlanRow[] {
  const sorted = [...groups].sort(compareGroups);
  // 품목별 지금까지의 합 (이미 들어간 기록 전부 + 이번에 넣기로 한 것)
  const running = new Map<string, number>();
  return sorted.map(g => {
    const base: MesPlanRow = { ...g, status: 'no-order', add: 0, already: 0 };
    const wo = orders.get(g.wo);
    if (!wo) return base;
    base.workOrderId = wo.id;
    base.outsource = wo.production_site === 'outsource';
    const item = wo.items.find(it => it.no === g.no);
    if (!item) return { ...base, status: 'no-item' };
    Object.assign(base, { itemId: item.id, itemQuantity: item.quantity, itemProduct: item.product_name, itemWidth: item.width_mm, itemHeight: item.height_mm });
    if (!sameSize(g, item)) return { ...base, status: 'size' };
    if (g.line !== 1 && g.line !== 2) return { ...base, status: 'line' };

    const already = item.logs.filter(l => l.date === g.date && l.line === g.line && l.shift === g.shift).reduce((s, l) => s + l.qty, 0);
    base.already = already;
    const need = g.count - already;
    if (need <= 0) return { ...base, status: 'done' };
    const total = running.get(item.id) ?? item.logs.reduce((s, l) => s + l.qty, 0);
    const room = Math.max(0, item.quantity - total);
    const add = Math.min(need, room);
    running.set(item.id, total + add);
    if (add <= 0) return { ...base, status: 'over' };
    return { ...base, status: add < need ? 'partial' : 'add', add };
  });
}

/** 넣는 줄 (add > 0) */
export const isInsert = (r: MesPlanRow) => r.status === 'add' || r.status === 'partial';

export const STATUS_TEXT: Record<MesStatus, string> = {
  add: '등록',
  partial: '일부 등록',
  done: '이미 등록됨',
  over: '의뢰 수량 초과',
  'no-order': '의뢰서 미등록',
  'no-item': '의뢰서에 없는 NO',
  size: '규격 다름',
  line: '호기 모름',
};
