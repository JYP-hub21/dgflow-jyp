/**
 * MES 생산실적 → MES 실적 표 (2026-11-13 이사님 요청, 2026-11-15 작업의뢰서 없이 넣는 방식으로 바꿈).
 *
 * MES 의 포장공정 바코드 기록(한 줄 = 복층유리 한 장)을 날짜 · 호기 · 주야간 · 의뢰번호 · NO 별 장수로 묶어
 * 표 dgflow_mes_production 에 넣는다(supabase/migrations/20261115_027_mes_production.sql).
 * 생산일지(일간 · 복층 · 주간)는 생산 기록과 이 표를 함께 읽는다(lib/production/logs.ts).
 * 11/13 회의 이사님: "MES 자료를 최대한 넣어 달라, 넣어 놓고 회사 주간생산일지와 비교해 진짜 빠진 것만 찾자".
 * 2026-11-15 사용자: "뭐든지 승인할 테니 일단 해 봐".
 *
 * 규칙
 *  - 같은 바코드(PID)가 두 번 찍혔으면 한 번만 센다.
 *  - **바코드 번호 사이 빈 장을 채운다** — 같은 규격 여러 장은 현장 요청으로 첫 장 · 끝 장에만 라벨을 붙여(80장이어도 2장 스캔)
 *    사이 장들이 MES 에 없다(11/13 회의). PID 는 "KCI02908" 처럼 글자 + 일련번호이고 한 품목의 유리는 번호가 이어진다.
 *    같은 품목에서 앞뒤로 찍힌 두 번호 사이가 비면, 빈 장은 **뒤에 찍힌 장과 같은 날 · 호기 · 주야간**에 만든 것으로 본다
 *    (끝 장을 찍을 때는 앞 장들이 이미 만들어져 있다). 2026 파일 대조: 지난 의뢰서 목록과 겹치는 2,362품목 중 의뢰 수량과 맞는
 *    품목이 찍힌 장수로는 1,774(75%), 번호로 채우면 2,181(92%).
 *  - 빈 번호가 MAX_FILL_GAP 장을 넘으면 다른 묶음 번호로 보고 채우지 않는다.
 *  - 주간 · 야간은 바코드를 찍은 시각으로 가른다 — 18:00 부터 야간.
 */
import { serialToIsoDate, type CellValue } from '@/lib/excel/xlsx-rows';

/**
 * 등록 잠금 — 2026-11-13 사용자 "실험만 하고 아직 화면에 자동으로 채우진 마" 로 잠갔다가,
 * 2026-11-15 사용자 "뭐든지 승인할 테니 일단 해 봐" 로 풀었다 (서버 · 화면이 함께 본다).
 */
export const MES_COMMIT_ENABLED = true;

/** 표 이름 */
export const MES_TABLE = 'dgflow_mes_production';

/** 바코드 번호 사이를 채우는 최대 장수 — 더 벌어지면 다른 묶음 번호로 본다 */
export const MAX_FILL_GAP = 500;

export type MesShift = 'day' | 'night';

/**
 * 야간이 시작되는 시각(자정부터 분) — 2026-11-13 회의(생산관리부):
 * 오전 8:30–12:30 · 오후 13:30–17:30 · 석식 30분 · 야간 18:00–21:00.
 * 석식 시간(17:30–18:00)에 찍힌 바코드는 주간 끝 작업으로 본다 (2026 MES 자료: 17:30–17:59 781장, 18시대부터 다시 늘어난다).
 * 시각을 바꾸면 이 값만 고친다. 단, 이미 올린 MES 자료가 있으면 주야간이 바뀌는 줄이 다시 올릴 때 "새 생산" 으로 들어가
 * 두 번 세어진다(줄의 열쇠가 날 · 호기 · 주야간이라서) — 바꾸기 전에 그 기간의 MES 의뢰서를 어떻게 할지 먼저 정한다.
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
  /** 바코드 "KCI02908" (없으면 빈 글자) */
  pid: string;
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
  // MES 엑셀은 빈 비고를 0 으로 내보낸다 — 작업의뢰서 비고 칸에 "0" 이 찍혔다 (2026-11-16)
  if (v === 0 || v === '0') return '';
  if (typeof v === 'number') return v > 36_000 && v < 60_000 ? serialToIsoDate(v, date1904) ?? String(v) : String(v);
  return text(v);
}

const text = (v: unknown) => (v === undefined || v === null || v === 0 || v === '0' ? '' : String(v).trim());
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
      pid, wo, no, date,
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

/** 바코드 "KCI02908" → 글자 "KCI" + 번호 2908. 번호가 없으면 null */
export function splitPid(pid: string): { prefix: string; num: number } | null {
  const m = /^(.*?)(\d+)$/.exec(pid.trim());
  return m ? { prefix: m[1].toUpperCase(), num: Number(m[2]) } : null;
}

/** 날짜 · 호기 · 주야간 · 품목별 장수 — 표 한 줄 */
export interface MesGroup {
  wo: string;
  no: number;
  date: string;
  line: number;
  shift: MesShift;
  /** 바코드가 찍힌 장수 */
  scanned: number;
  /** 바코드 번호 사이가 비어 채운 장수 */
  filled: number;
  product: string;
  width: number;
  height: number;
  customer: string;
  site: string;
  remark: string;
}

export const groupQty = (g: Pick<MesGroup, 'scanned' | 'filled'>) => g.scanned + g.filled;

export interface MesGrouping {
  groups: MesGroup[];
  /** 채우지 않은 큰 빈틈 수 (MAX_FILL_GAP 초과) */
  bigGaps: number;
}

const groupKey = (wo: string, no: number, date: string, line: number, shift: MesShift) => `${wo}|${no}|${date}|${line}|${shift}`;

/**
 * 장들을 품목 · 날짜 · 호기 · 주야간으로 묶고, 같은 품목의 바코드 번호 사이 빈 장을 뒤 장의 묶음에 채운다.
 * 빈틈은 파일 전체로 계산한 뒤 기간(from–to, 양 끝 포함)으로 거른다 — 기간 첫날의 장이 그 앞 장과의 빈틈을 가져가게.
 */
export function groupPieces(pieces: MesPiece[], from?: string, to?: string): MesGrouping {
  const map = new Map<string, MesGroup>();
  const add = (p: MesPiece, scanned: number, filled: number) => {
    const key = groupKey(p.wo, p.no, p.date, p.line, p.shift);
    const g = map.get(key);
    if (g) { g.scanned += scanned; g.filled += filled; return; }
    map.set(key, {
      wo: p.wo, no: p.no, date: p.date, line: p.line, shift: p.shift, scanned, filled,
      product: p.product, width: p.width, height: p.height, customer: p.customer, site: p.site, remark: p.remark,
    });
  };

  // 품목별로 모아 번호순으로
  const byItem = new Map<string, MesPiece[]>();
  for (const p of pieces) {
    const k = `${p.wo}|${p.no}`;
    const list = byItem.get(k);
    if (list) list.push(p); else byItem.set(k, [p]);
  }
  let bigGaps = 0;
  for (const list of byItem.values()) {
    const numbered = list.map(p => ({ p, id: splitPid(p.pid) }));
    numbered.sort((a, b) => (a.id && b.id ? a.id.prefix.localeCompare(b.id.prefix) || a.id.num - b.id.num : a.id ? -1 : b.id ? 1 : 0));
    for (let i = 0; i < numbered.length; i++) {
      const { p, id } = numbered[i];
      const prev = numbered[i - 1]?.id;
      let filled = 0;
      if (id && prev && prev.prefix === id.prefix) {
        const gap = id.num - prev.num - 1;
        if (gap > MAX_FILL_GAP) bigGaps++;
        else if (gap > 0) filled = gap;
      }
      add(p, p.qty, filled);
    }
  }
  const groups = [...map.values()]
    .filter(g => (!from || g.date >= from) && (!to || g.date <= to))
    .sort(compareGroups);
  return { groups, bigGaps };
}

export function compareGroups(a: { wo: string; no: number; date: string; line: number; shift?: MesShift }, b: typeof a): number {
  return a.wo.localeCompare(b.wo) || a.no - b.no || a.date.localeCompare(b.date) || a.line - b.line
    || (a.shift === b.shift ? 0 : a.shift === 'night' ? 1 : -1);
}

/** 날짜별 합계 — 화면 그래프 · 표 */
export interface MesDay {
  date: string;
  scanned: number;
  filled: number;
  /** 호기 → 주간 · 야간 장수(채운 것 포함) */
  lines: Record<number, { day: number; night: number }>;
}

export function dailyTotals(groups: MesGroup[]): MesDay[] {
  const map = new Map<string, MesDay>();
  for (const g of groups) {
    const d = map.get(g.date) ?? { date: g.date, scanned: 0, filled: 0, lines: {} };
    d.scanned += g.scanned;
    d.filled += g.filled;
    const l = (d.lines[g.line] ??= { day: 0, night: 0 });
    l[g.shift] += groupQty(g);
    map.set(g.date, d);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
