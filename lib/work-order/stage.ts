import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { deliveredByItem } from '@/lib/production/delivery';
import { loadDeliveries } from '@/lib/production/delivery-store';

/**
 * 작업의뢰서 상태 — 2026-11-06 회의: 100% 생산한 의뢰서도 '대기' 로 나온다, 납품까지 이어지게.
 * 화면에 보이는 단계는 수량에서 계산한다. 저장된 status 는 목록에서 끝난 건을 빼는 데 쓴다.
 */
export type WorkOrderStage = 'waiting' | 'producing' | 'produced' | 'delivering' | 'delivered' | 'done';

export const STAGE_LABELS: Record<WorkOrderStage, string> = {
  waiting: '대기',
  producing: '생산 중',
  produced: '생산 완료',
  delivering: '납품 중',
  delivered: '납품 완료',
  done: '완료',
};

export interface StageTotals {
  quantity: number;
  produced: number;
  /** 납품 합 — 의뢰서 전체 합이어도 된다. '납품 완료' 는 이 합이 아니라 저장된 status 로 가린다 */
  delivered?: number;
}

export function workOrderStage(status: string, { quantity, produced, delivered = 0 }: StageTotals): WorkOrderStage {
  // '납품 완료' 는 저장된 status(completed) 로만 정한다 — status 는 statusFor 가 품목마다 따져 저장한다.
  // 예전에는 의뢰서 전체 합으로 판정해 A 품목을 20 내보내고 B 품목이 0 이어도 '납품 완료' 로 보였다 (2026-11-10 점검).
  // 목록마다 넘기는 합이 품목별로 자른 값인지 아닌지에 상관없이 같은 답이 나오게 한다.
  if (status === 'completed') return quantity > 0 && delivered >= quantity ? 'delivered' : 'done';
  if (delivered > 0) return 'delivering';
  if (quantity > 0 && produced >= quantity) return 'produced';
  return produced > 0 ? 'producing' : 'waiting';
}

export interface StageItem {
  quantity: number;
  produced_quantity: number;
  /** 그 품목의 납품 합 (재고분이 더 나가 의뢰 수량을 넘을 수 있다) */
  delivered: number;
}

/**
 * 저장할 status — 품목마다 의뢰 수량만큼 다 나가야 끝난 건이다 (생산 현황 · 납품할 것 목록에서 빠진다).
 * 한 품목을 더 내보낸 것으로 다른 품목의 미납을 메우지 않는다 (2026-11-10 점검).
 */
export function statusFor(items: StageItem[]): 'pending' | 'in_progress' | 'completed' {
  const quantity = items.reduce((s, i) => s + i.quantity, 0);
  if (quantity > 0 && items.every(i => i.delivered >= i.quantity)) return 'completed';
  return items.some(i => i.produced_quantity > 0 || i.delivered > 0) ? 'in_progress' : 'pending';
}

/**
 * 생산 · 납품 기록이 바뀌면 부른다 — 납품 표가 없으면 납품 0 으로 친다.
 *
 * 읽기에 실패하면 status 를 고치지 않고 넘어간다. 예전에는 품목 읽기가 실패하면 빈 목록으로 계산해 '대기' 를 써 넣었고,
 * 납품 읽기가 실패하면 오류를 던져 — 기록은 이미 저장됐는데 화면은 실패로 알아 같은 납품을 두 번 넣게 됐다 (2026-11-10 점검).
 * 다음 기록이 바뀔 때 다시 맞춰진다.
 */
export async function syncWorkOrderStatus(supabase: SupabaseClient, workOrderId: string): Promise<void> {
  let items: { id: string; quantity: number; produced_quantity: number }[];
  let delivered: Map<string, number>;
  try {
    // 1,000줄에서 잘리지 않게 끝까지 읽는다 (2026-11-10 점검)
    const [itemRows, deliveries] = await Promise.all([
      fetchAll<{ id: string; quantity: number; produced_quantity: number }>((from, to) => supabase
        .from('dgflow_work_order_items').select('id, quantity, produced_quantity')
        .eq('work_order_id', workOrderId).order('id').range(from, to)),
      loadDeliveries(supabase, [workOrderId]),
    ]);
    items = itemRows;
    delivered = deliveredByItem(deliveries.logs);
  } catch (e) {
    console.error(`작업의뢰서 ${workOrderId} 상태를 맞추지 못했습니다:`, e);
    return;
  }
  const status = statusFor(items.map(i => ({ ...i, delivered: delivered.get(i.id) ?? 0 })));
  await supabase.from('dgflow_work_orders').update({ status }).eq('id', workOrderId);
}
