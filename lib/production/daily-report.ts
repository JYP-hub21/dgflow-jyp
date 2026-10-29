/**
 * 일간 생산일지 — 생산실적 기록을 날짜별로 묶는다.
 *
 * 생산실적은 "저장" 을 누를 때마다 한 줄씩 쌓인다. 같은 품목을 하루에 두 번 나눠 저장하면
 * 두 줄이 되는데, 일지에서 그걸 따로 보이면 "그날 무엇을 몇 장 만들었나" 가 흐려진다.
 * 그래서 **날짜 · 작업의뢰서 · 품목 · 주야 · 호기** 가 같으면 한 줄로 합친다.
 * 주야·호기는 합치지 않는다 — 누가 어느 라인에서 만들었는지는 일지에서 갈라 봐야 한다.
 */

export interface ProductionLogRow {
  production_date: string;
  quantity_completed: number;
  area_m2: number | null;
  shift: string | null;
  line_number: number | null;
  work_order_id: string;
  work_order_item_id: string | null;
  work_order_number: string;
  customer: string | null;
  site: string | null;
  product_name: string;
  width_mm: number | null;
  height_mm: number | null;
  /** 같은 품목의 작업의뢰서 내 순서 — 일지도 의뢰서 순서를 따른다 */
  sort_order: number | null;
  created_by_name: string | null;
}

export interface ReportLine {
  work_order_number: string;
  customer: string;
  site: string;
  product_name: string;
  width_mm: number | null;
  height_mm: number | null;
  quantity: number;
  area_m2: number;
  shift: 'day' | 'night';
  line_number: number;
  workers: string[];
}

export interface ReportDay {
  date: string;
  /** 일 · 월 · 화 … */
  weekday: string;
  lines: ReportLine[];
  quantity: number;
  area_m2: number;
  day_quantity: number;
  night_quantity: number;
  work_order_count: number;
}

export interface DailyReport {
  from: string;
  to: string;
  days: ReportDay[];
  quantity: number;
  area_m2: number;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' 의 요일. 시간대에 흔들리지 않도록 UTC 정오로 읽는다 */
export function weekdayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return WEEKDAYS[d.getUTCDay()] ?? '';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildDailyReport(logs: ProductionLogRow[], from: string, to: string): DailyReport {
  const byDate = new Map<string, Map<string, ReportLine & { sort: number }>>();

  for (const log of logs) {
    const shift = log.shift === 'night' ? 'night' : 'day';
    const line = log.line_number ?? 1;
    const itemKey = log.work_order_item_id
      ?? `${log.product_name}|${log.width_mm}|${log.height_mm}`;
    const key = [log.work_order_id, itemKey, shift, line].join('|');

    const day = byDate.get(log.production_date) ?? new Map();
    byDate.set(log.production_date, day);

    const prev = day.get(key);
    if (prev) {
      prev.quantity += log.quantity_completed;
      prev.area_m2 += Number(log.area_m2 || 0);
      if (log.created_by_name && !prev.workers.includes(log.created_by_name)) {
        prev.workers.push(log.created_by_name);
      }
      continue;
    }
    day.set(key, {
      work_order_number: log.work_order_number,
      customer: log.customer ?? '',
      site: log.site ?? '',
      product_name: log.product_name,
      width_mm: log.width_mm,
      height_mm: log.height_mm,
      quantity: log.quantity_completed,
      area_m2: Number(log.area_m2 || 0),
      shift,
      line_number: line,
      workers: log.created_by_name ? [log.created_by_name] : [],
      sort: log.sort_order ?? 0,
    });
  }

  const days: ReportDay[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, map]) => {
      const lines = [...map.values()]
        // 의뢰번호 → 주간 먼저 → 호기 → 의뢰서 안 순서
        .sort((a, b) =>
          a.work_order_number.localeCompare(b.work_order_number)
          || (a.shift === b.shift ? 0 : a.shift === 'day' ? -1 : 1)
          || a.line_number - b.line_number
          || a.sort - b.sort)
        .map(({ sort: _sort, ...l }) => ({ ...l, area_m2: round2(l.area_m2) }));
      const quantity = lines.reduce((s, l) => s + l.quantity, 0);
      return {
        date,
        weekday: weekdayOf(date),
        lines,
        quantity,
        area_m2: round2(lines.reduce((s, l) => s + l.area_m2, 0)),
        day_quantity: lines.filter(l => l.shift === 'day').reduce((s, l) => s + l.quantity, 0),
        night_quantity: lines.filter(l => l.shift === 'night').reduce((s, l) => s + l.quantity, 0),
        work_order_count: new Set(lines.map(l => l.work_order_number)).size,
      };
    });

  return {
    from,
    to,
    days,
    quantity: days.reduce((s, d) => s + d.quantity, 0),
    area_m2: round2(days.reduce((s, d) => s + d.area_m2, 0)),
  };
}

/** 'YYYY-MM-DD' 인지, 그리고 실제로 있는 날짜인지 */
export function isIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 기간 일수 (양 끝 포함) */
export function daysBetween(from: string, to: string): number {
  const ms = new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}
