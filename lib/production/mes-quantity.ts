import type { SupabaseClient } from '@supabase/supabase-js';
import { proRataArea, syncProducedQuantity } from './produced-quantity';
import { expectedArea } from '@/lib/work-order/verify';
import { isMesOrder } from './mes-orders';

/**
 * MES 로 만든 작업의뢰서의 수량 고치기 (2026-11-16 사용자 "ERP 의뢰 수량과 달라도 회사가 ERP 자료를 뽑기 귀찮아서
 * 최대한 이걸로 하자고 한 거니, 수정할 수 있게 모든 곳에 구현해 놔").
 *
 * MES 의뢰서는 의뢰 수량도 생산 수량도 MES 바코드에서 나왔다 — 바코드가 덜 찍혔으면 둘 다 적고, 재작업으로 더 찍혔으면
 * 둘 다 많다. 그래서 한쪽을 고치면 다른 쪽도 같이 맞춘다:
 *  - 의뢰 수량을 고치면 → 생산 기록 합도 그만큼으로 (늘면 마지막 생산 기록에 더하고, 줄면 마지막 기록부터 뺀다)
 *  - 생산 기록을 고쳐 의뢰 수량을 넘으면 → 의뢰 수량을 늘린다 (raiseQuantityTo)
 * 생산 기록이 하나도 없는 품목(수정 화면에서 새로 더한 품목)은 의뢰 수량만 바꾼다 — 언제 만들었는지 알 수 없어서.
 */

type Db = SupabaseClient;

interface ItemRow { id: string; work_order_id: string; quantity: number; width_mm: number; height_mm: number; area_m2: number | string | null }

/** 의뢰서가 MES 로 만든 것인가 */
export async function isMesWorkOrder(supabase: Db, workOrderId: string): Promise<boolean> {
  const { data } = await supabase.from('dgflow_work_orders').select('notes').eq('id', workOrderId).maybeSingle();
  return isMesOrder((data as { notes?: string | null } | null)?.notes);
}

/** 품목 면적을 새 수량에 맞춘다 — 장당 면적은 그대로 */
function areaFor(item: ItemRow, quantity: number): number {
  const a = proRataArea(item, quantity);
  return a > 0 ? a : expectedArea(item.width_mm, item.height_mm, quantity);
}

/**
 * MES 품목의 의뢰 수량을 바꾸고 생산 기록 합도 같게 맞춘다. 돌려주는 값: 맞춘 뒤 생산 수량.
 * 의뢰 수량은 1 이상 — 품목을 없애려면 수정 화면에서 지운다.
 */
export async function setMesItemQuantity(supabase: Db, itemId: string, target: number): Promise<number> {
  if (!Number.isInteger(target) || target < 1) throw new Error('수량은 1 이상의 정수여야 합니다.');
  const { data: item, error } = await supabase.from('dgflow_work_order_items')
    .select('id, work_order_id, quantity, width_mm, height_mm, area_m2').eq('id', itemId).single();
  if (error || !item) throw new Error(error?.message ?? '품목을 찾을 수 없습니다.');
  const row = item as ItemRow;
  const newArea = areaFor(row, target);
  const { error: upError } = await supabase.from('dgflow_work_order_items')
    .update({ quantity: target, area_m2: newArea }).eq('id', itemId);
  if (upError) throw new Error(upError.message);
  const sized = { ...row, quantity: target, area_m2: newArea };

  const { data: logs, error: logError } = await supabase.from('dgflow_production_logs')
    .select('id, quantity_completed, production_date')
    .eq('work_order_item_id', itemId)
    .order('production_date', { ascending: false }).order('id', { ascending: false });
  if (logError) throw new Error(logError.message);
  const list = (logs ?? []) as { id: string; quantity_completed: number }[];
  if (list.length === 0) return syncProducedQuantity(supabase, itemId);

  let diff = target - list.reduce((s, l) => s + l.quantity_completed, 0);
  if (diff > 0) {
    // 늘면 — 마지막 생산 기록에 더한다 (덜 찍힌 장은 마지막에 같이 만든 것으로 본다)
    const last = list[0];
    const q = last.quantity_completed + diff;
    const { error: e } = await supabase.from('dgflow_production_logs')
      .update({ quantity_completed: q, area_m2: proRataArea(sized, q) }).eq('id', last.id);
    if (e) throw new Error(e.message);
  } else {
    // 줄면 — 마지막 기록부터 뺀다. 0 이 되는 기록은 지운다
    for (const l of list) {
      if (diff >= 0) break;
      const take = Math.min(l.quantity_completed, -diff);
      diff += take;
      const q = l.quantity_completed - take;
      const { error: e } = q === 0
        ? await supabase.from('dgflow_production_logs').delete().eq('id', l.id)
        : await supabase.from('dgflow_production_logs').update({ quantity_completed: q, area_m2: proRataArea(sized, q) }).eq('id', l.id);
      if (e) throw new Error(e.message);
    }
  }
  return syncProducedQuantity(supabase, itemId);
}

/** 생산 기록을 고쳐 합이 의뢰 수량을 넘었을 때 — MES 품목이면 의뢰 수량을 그만큼 늘린다 */
export async function raiseQuantityTo(supabase: Db, itemId: string, total: number): Promise<void> {
  const { data: item } = await supabase.from('dgflow_work_order_items')
    .select('id, work_order_id, quantity, width_mm, height_mm, area_m2').eq('id', itemId).single();
  if (!item || (item as ItemRow).quantity >= total) return;
  const { error } = await supabase.from('dgflow_work_order_items')
    .update({ quantity: total, area_m2: areaFor(item as ItemRow, total) }).eq('id', itemId);
  if (error) throw new Error(error.message);
}
