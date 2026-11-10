import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTable, type EntriesStorage } from './bokcheung-store';
import { DELIVERY_TABLE, type DeliveryLog } from './delivery';

/** 납품 기록 읽기 — 표가 아직 없으면 storage 'none' 과 빈 목록 */
export async function loadDeliveries(supabase: SupabaseClient, workOrderIds: string[]): Promise<{
  storage: EntriesStorage;
  logs: DeliveryLog[];
}> {
  if (workOrderIds.length === 0) return { storage: 'db', logs: [] };
  const { data, error } = await supabase
    .from(DELIVERY_TABLE)
    .select('id, work_order_id, work_order_item_id, delivery_date, quantity, area_m2, note')
    .in('work_order_id', workOrderIds)
    .order('delivery_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { storage: 'none', logs: [] };
    throw new Error(error.message);
  }
  return { storage: 'db', logs: (data ?? []) as DeliveryLog[] };
}

/** 기간의 납품 기록 — 납품 메뉴의 날짜별 기록 · 그래프 */
export async function loadDeliveriesBetween(supabase: SupabaseClient, from: string, to: string): Promise<{
  storage: EntriesStorage;
  logs: DeliveryLog[];
}> {
  // 1,000줄에서 잘리지 않게 끝까지 나눠 읽는다 (2026-11-10 전체 점검)
  const logs: DeliveryLog[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from(DELIVERY_TABLE)
      .select('id, work_order_id, work_order_item_id, delivery_date, quantity, area_m2, note')
      .gte('delivery_date', from)
      .lte('delivery_date', to)
      .order('delivery_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + 999);
    if (error) {
      if (isMissingTable(error)) return { storage: 'none', logs: [] };
      throw new Error(error.message);
    }
    logs.push(...((data ?? []) as DeliveryLog[]));
    if (!data || data.length < 1000) break;
  }
  return { storage: 'db', logs };
}
