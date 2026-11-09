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
