/**
 * 생산 후 아직 납품하지 않은 재고 — 2026-11-13 회의(이사님 · 생산관리부).
 *
 * - 대표님 기준: 공장에서 생산한 뒤 2주까지는 기다려 줄 수 있고, 2주가 지나면 가져가라고 하거나 보관료를 받는다.
 * - 생산관리부는 현장별로 "몇 월에 생산된 것이 아직 출고되지 않았다" 를 매주 보고한다.
 * - 재고는 적게 둘수록 좋다 — 우리 돈으로 먼저 만들어 둔 것이고, 현장에 시공돼야 대금을 받는다. 야드도 부족하다.
 *
 * 어느 날 만든 것이 남았는지는 기록이 없으므로 "먼저 만든 것부터 나갔다" 고 본다(선입선출).
 * 그래서 남은 재고는 가장 늦게 만든 것들이다. 생산 기록 없이 수량만 있는 품목(지난 의뢰서 가져오기)은 생산일을 모른다.
 */

/** 생산 후 이 날수가 지나면 '2주 경과' — 대표님 기준 */
export const STOCK_GRACE_DAYS = 14;

export interface StockLot {
  /** 생산일 YYYY-MM-DD, 모르면 null */
  date: string | null;
  qty: number;
}

/**
 * 품목 하나의 남은 재고를 생산일별로 — 의뢰 수량까지만 센다(deliveryTodo 의 ready 와 같은 수).
 * logs 는 그 품목의 생산 기록(날짜 · 수량).
 */
export function itemStockLots(
  item: { quantity: number; produced_quantity: number },
  logs: { date: string; qty: number }[],
  delivered: number,
): StockLot[] {
  const produced = Math.max(0, Math.min(item.produced_quantity, item.quantity));
  let left = Math.max(0, produced - Math.max(0, Math.min(delivered, item.quantity)));
  if (left === 0) return [];
  // 늦게 만든 것부터 남는다
  const byDate = new Map<string, number>();
  for (const l of logs) if (l.qty > 0) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.qty);
  const lots: StockLot[] = [];
  for (const date of [...byDate.keys()].sort().reverse()) {
    if (left === 0) break;
    const take = Math.min(left, byDate.get(date)!);
    lots.push({ date, qty: take });
    left -= take;
  }
  if (left > 0) lots.push({ date: null, qty: left });
  return lots.reverse();
}

/** 두 날짜(YYYY-MM-DD) 사이 날수 — today 가 늦으면 양수 */
export function daysBetween(from: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface StockSummary {
  qty: number;
  /** 생산 후 2주가 지난 수량 */
  overdue: number;
  /** 생산일을 모르는 수량 */
  unknown: number;
  oldest: string | null;
  newest: string | null;
  /** 가장 오래된 것의 경과 날수 */
  oldestDays: number | null;
  /** 생산 월(YYYY-MM)별 수량, 오래된 달부터. 생산일 모름은 '' */
  byMonth: { month: string; qty: number }[];
}

export function summarizeLots(lots: StockLot[], today: string): StockSummary {
  const s: StockSummary = { qty: 0, overdue: 0, unknown: 0, oldest: null, newest: null, oldestDays: null, byMonth: [] };
  const months = new Map<string, number>();
  for (const l of lots) {
    s.qty += l.qty;
    const month = l.date ? l.date.slice(0, 7) : '';
    months.set(month, (months.get(month) ?? 0) + l.qty);
    if (!l.date) { s.unknown += l.qty; continue; }
    if (daysBetween(l.date, today) > STOCK_GRACE_DAYS) s.overdue += l.qty;
    if (!s.oldest || l.date < s.oldest) s.oldest = l.date;
    if (!s.newest || l.date > s.newest) s.newest = l.date;
  }
  s.oldestDays = s.oldest ? daysBetween(s.oldest, today) : null;
  s.byMonth = [...months].map(([month, qty]) => ({ month, qty }))
    .sort((a, b) => (a.month === '' ? 1 : b.month === '' ? -1 : a.month.localeCompare(b.month)));
  return s;
}
