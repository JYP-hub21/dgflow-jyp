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
