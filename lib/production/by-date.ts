/**
 * 작업의뢰서 하나를 날짜별로 — 한 의뢰서를 한 달씩 나눠 만드는 일이 잦다 (2026-10-30 회의 · 11-02 사용자:
 * "날짜가 많아지면 품목 칸에 늘어놓는 건 한계 — 같은 작업이라도 날짜에 따라 생산 현황에서 보게").
 *
 * 월 → 날짜 → 그날 만든 품목(주야 · 호기별)으로 묶는다. 최근 것부터.
 * 화면은 날짜 한 줄씩 접어 두고, 누르면 그날 품목이 펼쳐진다 — 날짜가 수십 개여도 길어지지 않는다.
 */
export interface DateLog {
  work_order_item_id: string | null;
  production_date: string;
  quantity_completed: number;
  area_m2: number | null;
  shift: string | null;
  line_number: number | null;
}

export interface DayRow { itemId: string | null; shift: 'day' | 'night'; line: number; quantity: number; area_m2: number }
export interface DayGroup { date: string; quantity: number; area_m2: number; itemCount: number; rows: DayRow[] }
export interface MonthGroup { month: string; quantity: number; area_m2: number; days: DayGroup[] }

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * @param order 품목 순서(작업의뢰서 번호) — 그날 품목을 종이 순서로 놓는다
 */
export function groupByDate(logs: DateLog[], order: (itemId: string | null) => number = () => 0): MonthGroup[] {
  const days = new Map<string, Map<string, DayRow>>();
  for (const l of logs) {
    const shift = l.shift === 'night' ? 'night' : 'day';
    const line = l.line_number ?? 1;
    const key = `${l.work_order_item_id ?? '-'}|${shift}|${line}`;
    const rows = days.get(l.production_date) ?? new Map<string, DayRow>();
    const row = rows.get(key) ?? { itemId: l.work_order_item_id, shift, line, quantity: 0, area_m2: 0 };
    row.quantity += l.quantity_completed;
    row.area_m2 = round2(row.area_m2 + Number(l.area_m2 ?? 0));
    rows.set(key, row);
    days.set(l.production_date, rows);
  }

  const months = new Map<string, MonthGroup>();
  for (const date of [...days.keys()].sort((a, b) => b.localeCompare(a))) {
    const rows = [...days.get(date)!.values()]
      .sort((a, b) => order(a.itemId) - order(b.itemId) || a.shift.localeCompare(b.shift) || a.line - b.line);
    const day: DayGroup = {
      date,
      quantity: rows.reduce((s, r) => s + r.quantity, 0),
      area_m2: round2(rows.reduce((s, r) => s + r.area_m2, 0)),
      itemCount: new Set(rows.map(r => r.itemId)).size,
      rows,
    };
    const m = date.slice(0, 7);
    const month = months.get(m) ?? { month: m, quantity: 0, area_m2: 0, days: [] };
    month.quantity += day.quantity;
    month.area_m2 = round2(month.area_m2 + day.area_m2);
    month.days.push(day);
    months.set(m, month);
  }
  return [...months.values()];
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** "10/31 (금)" */
export function dayLabel(date: string): string {
  const w = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8))} (${w})`;
}
/** "2026년 10월" */
export function monthLabel(month: string): string {
  return `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;
}
