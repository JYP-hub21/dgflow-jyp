import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllIn } from '@/lib/supabase/fetch-all';
import { isMissingTable, type EntriesStorage } from './bokcheung-store';
import { DELIVERY_TABLE, deliveredByItem, type DeliveryLog } from './delivery';

/**
 * 납품 기록 읽기 — 표가 아직 없으면 storage 'none' 과 빈 목록.
 *
 * 1,000줄에서 잘리지 않게 끝까지, 주소가 너무 길어지지 않게 의뢰서를 묶음으로 나눠 읽는다 (2026-11-10 점검 —
 * 최근 것부터 1,000줄만 와서 오래된 납품이 빠지고 미납이 부풀었다. 의뢰서가 많으면 주소가 길어 납품 화면 전체가 오류였다).
 */
export async function loadDeliveries(supabase: SupabaseClient, workOrderIds: string[]): Promise<{
  storage: EntriesStorage;
  logs: DeliveryLog[];
}> {
  if (workOrderIds.length === 0) return { storage: 'db', logs: [] };
  let logs: DeliveryLog[];
  try {
    logs = await fetchAllIn<DeliveryLog>(workOrderIds, (chunk, from, to) => supabase
      .from(DELIVERY_TABLE)
      .select('id, work_order_id, work_order_item_id, delivery_date, quantity, area_m2, note')
      .in('work_order_id', chunk)
      .order('delivery_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to));
  } catch (e) {
    // fetchAll 은 오류 글만 넘긴다 — 표가 없다는 글이면 아직 표를 안 만든 것
    const message = e instanceof Error ? e.message : String(e);
    if (isMissingTable({ message })) return { storage: 'none', logs: [] };
    throw e;
  }
  // 묶음마다 따로 정렬돼 왔다 — 최근 납품일이 위로 다시 맞춘다 (같은 날 안의 순서는 그대로 — sort 는 안정 정렬)
  logs.sort((a, b) => b.delivery_date.localeCompare(a.delivery_date));
  return { storage: 'db', logs };
}

/** 의뢰서 하나의 품목별 납품 합 — 표가 없으면 빈 값 */
export async function loadDeliveredByItem(supabase: SupabaseClient, workOrderId: string): Promise<Map<string, number>> {
  return deliveredByItem((await loadDeliveries(supabase, [workOrderId])).logs);
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
