import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllIn } from '@/lib/supabase/fetch-all';
import { itemNo } from './item-view';
import type { MesDbOrder } from './mes';

/**
 * 의뢰번호들 → 시스템의 작업의뢰서 · 품목 · 이미 들어간 생산 기록 (MES 가져오기 미리보기 · 등록이 함께 쓴다).
 * 1,000줄에서 잘리지 않게 끝까지 나눠 읽는다.
 */
export async function loadMesOrders(supabase: SupabaseClient, numbers: string[]): Promise<MesDbOrder[]> {
  const unique = [...new Set(numbers)];
  if (unique.length === 0) return [];
  const orders = await fetchAllIn<{ id: string; work_order_number: string; production_site: string | null }>(unique, (chunk, a, b) => supabase
    .from('dgflow_work_orders').select('id, work_order_number, production_site')
    .in('work_order_number', chunk).order('id').range(a, b));
  if (orders.length === 0) return [];

  const items = await fetchAllIn<{
    id: string; work_order_id: string; item_no: number | null; sort_order: number | null;
    product_name: string; width_mm: number; height_mm: number; quantity: number; area_m2: number | string | null;
  }>(orders.map(o => o.id), (chunk, a, b) => supabase
    .from('dgflow_work_order_items')
    .select('id, work_order_id, item_no, sort_order, product_name, width_mm, height_mm, quantity, area_m2')
    .in('work_order_id', chunk).order('id').range(a, b));

  const logs = items.length === 0 ? [] : await fetchAllIn<{
    work_order_item_id: string; production_date: string; line_number: number | null; shift: string | null; quantity_completed: number;
  }>(items.map(i => i.id), (chunk, a, b) => supabase
    .from('dgflow_production_logs')
    .select('work_order_item_id, production_date, line_number, shift, quantity_completed')
    .in('work_order_item_id', chunk).order('id').range(a, b));

  const logsByItem = new Map<string, MesDbOrder['items'][number]['logs']>();
  for (const l of logs) {
    const list = logsByItem.get(l.work_order_item_id) ?? [];
    list.push({ date: l.production_date, line: l.line_number ?? 1, shift: l.shift === 'night' ? 'night' : 'day', qty: l.quantity_completed });
    logsByItem.set(l.work_order_item_id, list);
  }
  const itemsByOrder = new Map<string, MesDbOrder['items']>();
  for (const it of items) {
    const list = itemsByOrder.get(it.work_order_id) ?? [];
    list.push({
      id: it.id, no: itemNo(it), product_name: it.product_name, width_mm: it.width_mm, height_mm: it.height_mm,
      quantity: it.quantity, area_m2: it.area_m2, logs: logsByItem.get(it.id) ?? [],
    });
    itemsByOrder.set(it.work_order_id, list);
  }
  return orders.map(o => ({
    id: o.id, work_order_number: o.work_order_number, production_site: o.production_site ?? 'ochang',
    items: itemsByOrder.get(o.id) ?? [],
  }));
}
