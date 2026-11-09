import type { SupabaseClient } from '@supabase/supabase-js';
import { DELIVERY_TABLE } from '@/lib/production/delivery';
import { isMissingTable } from '@/lib/production/bokcheung-store';

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

export interface StageTotals { quantity: number; produced: number; delivered?: number }

export function workOrderStage(status: string, { quantity, produced, delivered = 0 }: StageTotals): WorkOrderStage {
  if (quantity > 0 && delivered >= quantity) return 'delivered';
  if (status === 'completed') return 'done';
  if (delivered > 0) return 'delivering';
  if (quantity > 0 && produced >= quantity) return 'produced';
  return produced > 0 ? 'producing' : 'waiting';
}

/** 저장할 status — 전량 납품하면 끝난 건으로 친다 (생산 현황 목록에서 빠진다) */
export function statusFor(totals: StageTotals): 'pending' | 'in_progress' | 'completed' {
  const { quantity, produced, delivered = 0 } = totals;
  if (quantity > 0 && delivered >= quantity) return 'completed';
  return produced > 0 || delivered > 0 ? 'in_progress' : 'pending';
}

/** 생산 · 납품 기록이 바뀌면 부른다 — 표가 없으면 납품 0 으로 친다 */
export async function syncWorkOrderStatus(supabase: SupabaseClient, workOrderId: string): Promise<void> {
  const [{ data: items }, deliveries] = await Promise.all([
    supabase.from('dgflow_work_order_items').select('quantity, produced_quantity').eq('work_order_id', workOrderId),
    supabase.from(DELIVERY_TABLE).select('quantity').eq('work_order_id', workOrderId),
  ]);
  if (deliveries.error && !isMissingTable(deliveries.error)) throw new Error(deliveries.error.message);
  const list = items ?? [];
  const status = statusFor({
    quantity: list.reduce((s, i) => s + i.quantity, 0),
    produced: list.reduce((s, i) => s + i.produced_quantity, 0),
    delivered: (deliveries.data ?? []).reduce((s, d) => s + d.quantity, 0),
  });
  await supabase.from('dgflow_work_orders').update({ status }).eq('id', workOrderId);
}
