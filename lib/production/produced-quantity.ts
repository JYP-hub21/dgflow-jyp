import type { createServerSupabaseClient } from '@/lib/supabase/server';
import { expectedArea } from '@/lib/work-order/verify';

type Supabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * 품목의 생산완료 수량을 생산 기록의 합으로 다시 맞춘다.
 *
 * 기록을 고치거나 지울 수 있게 되면서 "기존 값 + 이번 수량" 으로 더해 가는 방식은
 * 한 번만 어긋나도 영영 틀린 채 남는다. 기록이 원본이고 완료 수량은 그 합일 뿐이다.
 */
export async function syncProducedQuantity(supabase: Supabase, itemId: string): Promise<number> {
  const { data } = await supabase
    .from('dgflow_production_logs')
    .select('quantity_completed')
    .eq('work_order_item_id', itemId);
  const total = (data || []).reduce((s, l) => s + l.quantity_completed, 0);
  await supabase.from('dgflow_work_order_items').update({ produced_quantity: total }).eq('id', itemId);
  return total;
}

/**
 * 생산 · 납품 기록 한 줄의 면적 — 품목에 저장된 면적을 수량 비율로 나눈다.
 *
 * 작업의뢰서 면적은 회사 ERP 규칙(장당 2자리 반올림 · 최소 3재 0.28㎡)으로 찍혀 있는데, 기록은 가로×세로×수량을
 * 한 번에 반올림해 1719×1820×15 가 의뢰서 46.95 · 기록 46.93 으로 어긋났다 (2026-11-10 점검).
 * 품목 면적 ÷ 의뢰 수량 × 이번 수량으로 맞춘다. 이미 저장된 기록은 그대로다.
 * 품목 면적이 없거나 의뢰 수량이 0 이면 ERP 규칙으로 계산한다.
 */
export function proRataArea(
  item: { width_mm: number; height_mm: number; quantity: number; area_m2: number | string | null },
  quantity: number,
): number {
  const area = item.area_m2 === null || item.area_m2 === '' ? NaN : Number(item.area_m2);
  if (item.quantity > 0 && Number.isFinite(area)) return Math.round(area / item.quantity * quantity * 100) / 100;
  return expectedArea(item.width_mm, item.height_mm, quantity);
}

export async function calculateItemArea(supabase: Supabase, itemId: string, quantity: number): Promise<number> {
  if (!itemId) return 0;
  const { data } = await supabase
    .from('dgflow_work_order_items')
    .select('width_mm, height_mm, quantity, area_m2')
    .eq('id', itemId)
    .single();
  if (!data) return 0;
  return proRataArea(data, quantity);
}
