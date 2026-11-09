/**
 * 주간생산일지 — 회사가 손으로 쓰던 "주간생산일지(2026).xlsx" 한 주 시트를 시스템에서 쓴다.
 *
 * 2026-11-06 사용자 요청: 시스템에서 작성하고 엑셀도 양식 그대로 나오게. 엑셀 맨 아래(복층 · 3복층 칸)를
 * 고치면 위 표가 전부 바뀌는 구조까지 같게.
 *
 * 회사 양식에서 확인한 규칙 ('양식' 시트 수식, 1031 시트 값으로 대조):
 *  · 한 주 = 월–토 여섯 줄. 호기마다 표 하나 (1호기 · 2호기).
 *  · 맨 아래 칸: 날마다 복층 · 3복층의 조 · M2. 합계 = 복층 + 3복층 × 2 (삼복층 200% 적용, 24.10.29~).
 *  · 위 표의 생산조 · 생산M2 는 그 합계를 끌어온다 — 그래서 아래를 고치면 위가 바뀐다.
 *  · 목표 = 근무시간 × 최소기준(55) × 목표비율(120%). 환산 A = 생산조 ÷ 목표 × 50, 환산 B = 생산M2 ÷ 목표 × 54.45.
 *  · 평가 = 환산 계가 100 이상 좋아요 · 90 이상 90~99 · 80 이상 80~89 · 아래는 사유를 적는다.
 *  · 인원 총계 = 투입 · 마킹 · 마감1 · 마감2 는 1명, 나머지(간봉 · 부틸 · 절단 · 밴딩)는 0.5명.
 *
 * 복층 · 3복층 나누기: 5겹 이상(유리 3장)을 3복층으로 친다. 회사 파일 1–5월과 대조하면 두 파일이 맞는 159건 중
 * 143건이 이 규칙대로다. 나머지는 2겹인데 회사가 2배를 준 MZT 품목 등이다.
 * 회의(2026-11-06): 3복층 칸은 어려운 공정을 200% 쳐 주는 칸이다 — 3복층 · 스텝 · 이형 등을 담당자가 보고 넣는다.
 * 이 일지가 호기별 포상의 근거라 자동 값은 시작값일 뿐이고 사람이 맨 아래 칸에서 고친다.
 * 근무시간도 사람이 적는다 — 설비 고장 같은 부동시간은 빼고 실제 생산한 시간을 넣는다.
 */
import { glassParts, parseProductName } from './bokcheung';
import type { ProductionLogRow } from './daily-report';

/** 양식 위쪽 칸 — 최소기준 · 목표비율 · 환산 비중 */
export const MIN_STANDARD = 55;
export const TARGET_RATIO = 1.2;
export const WEIGHT_A = 50;
export const WEIGHT_B = 54.45;
/** 3복층 가중치 — 맨 아래 합계 칸 수식 */
export const TRIPLE_FACTOR = 2;

/** 양식이 호기마다 표를 하나씩 갖는 호기 */
export const WEEKLY_LINES = [1, 2];
export const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토'] as const;

/** 근무 구분 — 고르면 근무시간 기본값이 들어간다 (시간은 실제대로 고칠 수 있다) */
export const SHIFT_TYPES = [
  { value: '평일', hours: 8 },
  { value: '주간연장', hours: 11 },
  { value: '주말', hours: 8 },
  { value: '휴무', hours: 0 },
] as const;

/** 투입 인원 칸 — 양식 열 순서. weight 는 총계에 세는 사람 수 */
export const CREW_COLUMNS = [
  { key: 'feed', col: 'I', label: '투입', weight: 1 },
  { key: 'marking', col: 'J', label: '마킹', weight: 1 },
  { key: 'finish1', col: 'K', label: '마감1', weight: 1 },
  { key: 'finish2', col: 'L', label: '마감2', weight: 1 },
  { key: 'spacer1', col: 'M', label: '기타(간봉)', weight: 0.5 },
  { key: 'spacer2', col: 'N', label: '기타(간봉)', weight: 0.5 },
  { key: 'spacer3', col: 'O', label: '기타(간봉)', weight: 0.5 },
  { key: 'butyl', col: 'P', label: '부틸', weight: 0.5 },
  { key: 'spacerCut', col: 'Q', label: '기타(간봉절단)', weight: 0.5 },
  { key: 'banding', col: 'R', label: '기타(밴딩)', weight: 0.5 },
] as const;
export type CrewKey = typeof CREW_COLUMNS[number]['key'];

/** 생산 수량 한 칸 — 조 · M2 */
export interface WeeklyOutput { jo: number; m2: number }

/** 사람이 적는 하루치 (호기별). 비워 둔 복층 · 3복층 칸은 생산 기록 값을 쓴다 */
export interface WeeklyDayEntry {
  shift_type: string;
  work_hours: number | null;
  barcode_qty: number | null;
  crew: Partial<Record<CrewKey, string>>;
  reason: string;
  double_jo: number | null;
  double_m2: number | null;
  triple_jo: number | null;
  triple_m2: number | null;
}

export const EMPTY_DAY_ENTRY: WeeklyDayEntry = {
  shift_type: '', work_hours: null, barcode_qty: null, crew: {}, reason: '',
  double_jo: null, double_m2: null, triple_jo: null, triple_m2: null,
};

/** 양식 위쪽 칸의 기준값 — 주마다 바꿀 일이 드물지만 양식에서 고칠 수 있는 칸이다 */
export interface WeeklySettings { minStandard: number; targetRatio: number }
export const DEFAULT_SETTINGS: WeeklySettings = { minStandard: MIN_STANDARD, targetRatio: TARGET_RATIO };

export interface WeekInfo {
  /** 월요일 YYYY-MM-DD */
  monday: string;
  /** 토요일 YYYY-MM-DD */
  saturday: string;
  /** 월–토 여섯 날짜 */
  days: string[];
  year: number;
  /** ISO 주차 */
  weekNumber: number;
  /** "10월 5주" 의 달 · 주 */
  month: number;
  weekOfMonth: number;
  /** 시트 이름 — 회사 파일처럼 토요일 "1031" */
  sheetName: string;
  /** 양식 맨 위 줄 */
  title: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (date: string) => new Date(`${date}T12:00:00Z`);
const plus = (d: Date, n: number) => { const c = new Date(d); c.setUTCDate(c.getUTCDate() + n); return c; };
const mondayOf = (d: Date) => plus(d, -((d.getUTCDay() + 6) % 7));

/** 그 달의 몇째 주인가 — 달의 첫 근무일(1일이 일요일이면 2일)이 든 주가 1주 */
function weekOfMonth(monday: Date, month: number, year: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const firstWork = first.getUTCDay() === 0 ? plus(first, 1) : first;
  return Math.round((monday.getTime() - mondayOf(firstWork).getTime()) / (7 * 86_400_000)) + 1;
}

/**
 * 날짜가 든 주 — 회사 시트 제목 규칙: "2026년 44주차 ( 10월 5주)".
 * 달이 걸치는 주는 목요일이 있는 달로 친다 (1003 = 9/28–10/3 → 10월 1주, 0502 = 4/27–5/2 → 4월 5주).
 */
export function weekOf(date: string): WeekInfo {
  const monday = mondayOf(utc(date));
  const thursday = plus(monday, 3);
  const year = thursday.getUTCFullYear();
  const month = thursday.getUTCMonth() + 1;
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  const weekNumber = Math.round((monday.getTime() - mondayOf(jan4).getTime()) / (7 * 86_400_000)) + 1;
  const n = weekOfMonth(monday, month, year);
  const saturday = plus(monday, 5);
  const p2 = (v: number) => String(v).padStart(2, '0');
  return {
    monday: iso(monday),
    saturday: iso(saturday),
    days: [0, 1, 2, 3, 4, 5].map(i => iso(plus(monday, i))),
    year,
    weekNumber,
    month,
    weekOfMonth: n,
    sheetName: `${p2(saturday.getUTCMonth() + 1)}${p2(saturday.getUTCDate())}`,
    title: ` ${year}년 ${weekNumber}주차  ( ${month}월  ${n}주)`,
  };
}

/** 3복층인가 — 유리 · 간봉이 5겹 이상 */
export function isTriple(productName: string): boolean {
  return glassParts(parseProductName(productName).composition).length >= 5;
}

/** 생산 기록 → 날짜 · 호기별 복층 · 3복층 조 · M2 */
export type WeeklyAuto = Record<string, Record<number, { double: WeeklyOutput; triple: WeeklyOutput }>>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function autoOutputs(logs: ProductionLogRow[]): WeeklyAuto {
  const out: WeeklyAuto = {};
  for (const log of logs) {
    if (!parseProductName(log.product_name).insulated) continue;
    const line = log.line_number && log.line_number > 0 ? log.line_number : 1;
    const day = (out[log.production_date] ??= {});
    const cell = (day[line] ??= { double: { jo: 0, m2: 0 }, triple: { jo: 0, m2: 0 } });
    const bucket = isTriple(log.product_name) ? cell.triple : cell.double;
    bucket.jo += log.quantity_completed;
    bucket.m2 = round2(bucket.m2 + Number(log.area_m2 || 0));
  }
  return out;
}

/** 위 표 한 줄 — 양식 수식 결과 */
export interface WeeklyRow {
  date: string;
  weekday: string;
  shift_type: string;
  hours: number;
  barcode: number | null;
  /** 바코드 입력 비율 — 생산조가 0 이면 비운다 */
  barcodeRatio: number | null;
  crewTotal: number;
  target: number;
  jo: number;
  joPerHour: number | '휴무';
  joRate: number;
  m2: number;
  m2PerHour: number | '휴무';
  m2Rate: number;
  scoreA: number | '휴무';
  scoreB: number | '휴무';
  score: number | '휴무';
  grade: string;
  reason: string;
  /** 맨 아래 칸에 들어간 값 — 사람이 고친 값이 앞선다 */
  double: WeeklyOutput;
  triple: WeeklyOutput;
}

export interface WeeklyTotals {
  hours: number;
  target: number;
  jo: number;
  joPerHour: number;
  joRate: number;
  m2: number;
  m2PerHour: number;
  m2Rate: number;
  scoreA: number;
  scoreB: number;
  score: number | '휴무';
  grade: string;
}

export interface WeeklyLineSheet {
  line: number;
  rows: WeeklyRow[];
  totals: WeeklyTotals;
}

export interface WeeklySheet {
  week: WeekInfo;
  lines: WeeklyLineSheet[];
}

/** 평가 칸 — 양식 수식 그대로 (문구 앞 빈칸까지) */
export function gradeOf(hours: number, score: number | '휴무'): string {
  if (hours === 0 || score === '휴무') return '휴무';
  if (score >= 100) return '좋아요';
  if (score >= 90) return '90~99';
  if (score >= 80) return '80~89';
  return ' 사유?→';
}

/** 인원 총계 — 앞 네 칸은 1명, 뒤 여섯 칸은 0.5명 */
export function crewTotal(crew: WeeklyDayEntry['crew']): number {
  return CREW_COLUMNS.reduce((s, c) => s + ((crew[c.key] ?? '').trim() ? c.weight : 0), 0);
}

function computeRow(
  date: string, index: number, entry: WeeklyDayEntry, auto: { double: WeeklyOutput; triple: WeeklyOutput } | undefined,
  settings: WeeklySettings,
): WeeklyRow {
  const hours = entry.work_hours ?? 0;
  const double = { jo: entry.double_jo ?? auto?.double.jo ?? 0, m2: entry.double_m2 ?? auto?.double.m2 ?? 0 };
  const triple = { jo: entry.triple_jo ?? auto?.triple.jo ?? 0, m2: entry.triple_m2 ?? auto?.triple.m2 ?? 0 };
  const jo = double.jo + triple.jo * TRIPLE_FACTOR;
  const m2 = round2(double.m2 + triple.m2 * TRIPLE_FACTOR);
  const target = hours * settings.minStandard * settings.targetRatio;
  const off = hours === 0;
  const scoreA = off ? '휴무' as const : jo / target * WEIGHT_A;
  const scoreB = off ? '휴무' as const : m2 / target * WEIGHT_B;
  const score = off ? '휴무' as const : (scoreA as number) + (scoreB as number);
  return {
    date,
    weekday: WEEKDAY_LABELS[index],
    shift_type: entry.shift_type,
    hours,
    barcode: entry.barcode_qty,
    barcodeRatio: entry.barcode_qty !== null && jo > 0 ? entry.barcode_qty / jo * 100 : null,
    crewTotal: crewTotal(entry.crew),
    target,
    jo,
    joPerHour: off ? '휴무' : jo / hours,
    joRate: target > 0 ? jo / target : 0,
    m2,
    m2PerHour: off ? '휴무' : m2 / hours,
    m2Rate: target > 0 ? m2 / target : 0,
    scoreA,
    scoreB,
    score,
    grade: gradeOf(hours, score),
    reason: entry.reason,
    double,
    triple,
  };
}

function computeTotals(rows: WeeklyRow[]): WeeklyTotals {
  const hours = rows.reduce((s, r) => s + r.hours, 0);
  const target = rows.reduce((s, r) => s + r.target, 0);
  const jo = rows.reduce((s, r) => s + r.jo, 0);
  const m2 = round2(rows.reduce((s, r) => s + r.m2, 0));
  const scoreA = target > 0 ? jo / target * WEIGHT_A : 0;
  const scoreB = target > 0 ? m2 / target * WEIGHT_B : 0;
  const score = hours === 0 ? '휴무' as const : scoreA + scoreB;
  return {
    hours,
    target,
    jo,
    joPerHour: hours > 0 ? jo / hours : 0,
    joRate: target > 0 ? jo / target : 0,
    m2,
    m2PerHour: hours > 0 ? m2 / hours : 0,
    m2Rate: target > 0 ? m2 / target : 0,
    scoreA,
    scoreB,
    score,
    grade: gradeOf(hours, score),
  };
}

/** 입력 열쇠 — `${날짜}|${호기}` */
export const dayKey = (date: string, line: number) => `${date}|${line}`;

/**
 * 표를 낼 호기 — 1 · 2호기는 늘, 더한 호기(미니라인 등)는 쓰는 호기와 그 주 기록이 있는 호기.
 * activeLines 는 호기 목록에서 쓰는 호기 번호.
 */
export function weeklyLineNumbers(
  activeLines: number[], entries: Record<string, WeeklyDayEntry | undefined>, auto: WeeklyAuto,
): number[] {
  const used = new Set<number>([...WEEKLY_LINES, ...activeLines]);
  for (const key of Object.keys(entries)) used.add(Number(key.split('|')[1]));
  for (const day of Object.values(auto)) for (const line of Object.keys(day)) used.add(Number(line));
  return [...used].filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
}

/** 그 호기에 이 주 적은 값이나 생산이 있나 — 더한 호기는 있을 때만 엑셀 시트를 만든다 */
export function lineHasData(block: WeeklyLineSheet): boolean {
  return block.rows.some(r => r.hours > 0 || r.jo > 0 || r.m2 > 0 || r.crewTotal > 0 || r.reason.trim() !== '');
}

/** 한 주 시트 계산 — 화면 · 엑셀이 같은 값을 쓴다 */
export function buildWeeklySheet(
  date: string, entries: Record<string, WeeklyDayEntry | undefined>, auto: WeeklyAuto,
  settings: WeeklySettings = DEFAULT_SETTINGS, lineNumbers: number[] = WEEKLY_LINES,
): WeeklySheet {
  const week = weekOf(date);
  const lines = lineNumbers.map(line => {
    const rows = week.days.map((d, i) => computeRow(d, i, entries[dayKey(d, line)] ?? EMPTY_DAY_ENTRY, auto[d]?.[line], settings));
    return { line, rows, totals: computeTotals(rows) };
  });
  return { week, lines };
}
