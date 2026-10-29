import type { createServerSupabaseClient } from '@/lib/supabase/server';

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

export async function calculateItemArea(supabase: Supabase, itemId: string, quantity: number): Promise<number> {
  if (!itemId) return 0;
  const { data } = await supabase
    .from('dgflow_work_order_items')
    .select('width_mm, height_mm')
    .eq('id', itemId)
    .single();
  if (!data) return 0;
  return Math.round(data.width_mm * data.height_mm * quantity / 1_000_000 * 100) / 100;
}
