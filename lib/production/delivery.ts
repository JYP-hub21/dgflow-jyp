/**
 * 납품 기록 — 표 dgflow_delivery_logs (supabase/migrations/20261106_024_delivery_logs.sql).
 *
 * 2026-11-06 회의: 생산 수량처럼 납품 수량을 입력한다. 날짜는 납품일(현장에 들어가는 날) 기준이고,
 * 일부만 나가거나 며칠에 나뉘어 나가는 일이 많다. 재고가 함께 나가 생산 수량을 넘을 수 있어 막지 않고 알리기만 한다.
 */
export const DELIVERY_TABLE = 'dgflow_delivery_logs';

export interface DeliveryLog {
  id: string;
  work_order_id: string;
  work_order_item_id: string;
  delivery_date: string;
  quantity: number;
  area_m2: number | null;
  note: string | null;
}

export interface DeliveryDay {
  date: string;
  quantity: number;
  area_m2: number;
  logs: DeliveryLog[];
}

/** 품목별 납품 합계 */
export function deliveredByItem(logs: Pick<DeliveryLog, 'work_order_item_id' | 'quantity'>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of logs) out.set(l.work_order_item_id, (out.get(l.work_order_item_id) ?? 0) + l.quantity);
  return out;
}

/** 의뢰서별 납품 합계 */
export function deliveredByWorkOrder(logs: Pick<DeliveryLog, 'work_order_id' | 'quantity'>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of logs) out.set(l.work_order_id, (out.get(l.work_order_id) ?? 0) + l.quantity);
  return out;
}

/** 날짜별로 묶는다 — 최근 납품일이 위로 */
export function groupDeliveries(logs: DeliveryLog[]): DeliveryDay[] {
  const byDate = new Map<string, DeliveryDay>();
  for (const l of logs) {
    const day = byDate.get(l.delivery_date) ?? { date: l.delivery_date, quantity: 0, area_m2: 0, logs: [] };
    day.quantity += l.quantity;
    day.area_m2 = Math.round((day.area_m2 + Number(l.area_m2 || 0)) * 100) / 100;
    day.logs.push(l);
    byDate.set(l.delivery_date, day);
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// ── 납품 메뉴 (/deliveries, 2026-11-09 "생산관리부 탭에 납품 탭을 하나 만들자") ──

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM' → 그달 1일과 말일 */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

/** 'YYYY-MM' 을 delta 달 옮긴다 */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** 'YYYY-MM' 꼴인지 */
export const isMonth = (s: string | undefined | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export interface DeliveryDailyPoint {
  date: string;
  /** 축 이름 "11/9" */
  label: string;
  weekday: string;
  quantity: number;
  area_m2: number;
}

/** 기간의 날마다 한 점 — 납품이 없는 날도 0 으로 넣어 막대 사이가 비어 보이게 한다 */
export function dailyDeliveryTotals(
  logs: Pick<DeliveryLog, 'delivery_date' | 'quantity' | 'area_m2'>[], from: string, to: string,
): DeliveryDailyPoint[] {
  const sums = new Map<string, { q: number; a: number }>();
  for (const l of logs) {
    const s = sums.get(l.delivery_date) ?? { q: 0, a: 0 };
    s.q += l.quantity;
    s.a += Number(l.area_m2 || 0);
    sums.set(l.delivery_date, s);
  }
  const out: DeliveryDailyPoint[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const s = sums.get(date);
    out.push({
      date, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, weekday: WEEKDAYS[d.getUTCDay()],
      quantity: s?.q ?? 0, area_m2: Math.round((s?.a ?? 0) * 100) / 100,
    });
  }
  return out;
}

export interface DeliveryDayOrder {
  work_order_id: string;
  quantity: number;
  area_m2: number;
  /** 그날 그 의뢰서에 적은 비고 (겹치는 것은 한 번만) */
  notes: string[];
}

export interface DeliveryDayByOrder {
  date: string;
  weekday: string;
  quantity: number;
  area_m2: number;
  orders: DeliveryDayOrder[];
}

/** 날짜 → 의뢰서별 합계. 최근 날짜가 위, 그날 안에서는 많이 나간 의뢰서가 위 */
export function deliveriesByDateAndOrder(logs: DeliveryLog[]): DeliveryDayByOrder[] {
  const days = new Map<string, DeliveryDayByOrder>();
  for (const l of logs) {
    const day = days.get(l.delivery_date) ?? {
      date: l.delivery_date, weekday: WEEKDAYS[new Date(`${l.delivery_date}T00:00:00Z`).getUTCDay()],
      quantity: 0, area_m2: 0, orders: [],
    };
    let order = day.orders.find(o => o.work_order_id === l.work_order_id);
    if (!order) { order = { work_order_id: l.work_order_id, quantity: 0, area_m2: 0, notes: [] }; day.orders.push(order); }
    order.quantity += l.quantity;
    order.area_m2 = Math.round((order.area_m2 + Number(l.area_m2 || 0)) * 100) / 100;
    const note = (l.note ?? '').trim();
    if (note && !order.notes.includes(note)) order.notes.push(note);
    day.quantity += l.quantity;
    day.area_m2 = Math.round((day.area_m2 + Number(l.area_m2 || 0)) * 100) / 100;
    days.set(l.delivery_date, day);
  }
  return [...days.values()]
    .map(d => ({ ...d, orders: d.orders.sort((a, b) => b.quantity - a.quantity) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface DeliveryTodo {
  quantity: number;
  produced: number;
  delivered: number;
  /** 아직 안 나간 수량 */
  remaining: number;
  /** 만들어 놓고 아직 안 나간 수량 — 지금 실을 수 있는 것 */
  ready: number;
}

/** 의뢰서 하나의 납품 할 일 */
export function deliveryTodo(items: { quantity: number; produced_quantity: number }[], delivered: number): DeliveryTodo {
  const quantity = items.reduce((s, i) => s + i.quantity, 0);
  const produced = items.reduce((s, i) => s + Math.min(i.produced_quantity, i.quantity), 0);
  return {
    quantity, produced, delivered,
    remaining: Math.max(0, quantity - delivered),
    ready: Math.max(0, produced - delivered),
  };
}
