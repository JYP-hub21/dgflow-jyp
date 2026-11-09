import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTable, type EntriesStorage } from '@/lib/production/bokcheung-store';

/**
 * 작업의뢰서 수신 확인 — 표 dgflow_work_order_receipts
 * (supabase/migrations/20261106_025_work_order_receipts.sql).
 * 2026-11-06 회의: 업무지원부가 올린 의뢰서를 생산관리부가 받았다고 확인하고 시각까지 남긴다.
 * 표를 만들기 전에는 storage 'none' 이라 화면에 수신 칸이 나오지 않는다.
 */
export const RECEIPTS_TABLE = 'dgflow_work_order_receipts';

export interface Receipt {
  received_at: string;
  received_by_name: string | null;
}

export async function loadReceipts(supabase: SupabaseClient, ids: string[]): Promise<{
  storage: EntriesStorage;
  receipts: Map<string, Receipt>;
}> {
  const receipts = new Map<string, Receipt>();
  if (ids.length === 0) {
    const { error } = await supabase.from(RECEIPTS_TABLE).select('work_order_id').limit(1);
    return { storage: error && isMissingTable(error) ? 'none' : 'db', receipts };
  }
  const { data, error } = await supabase
    .from(RECEIPTS_TABLE)
    .select('work_order_id, received_at, receiver:dgflow_users!received_by(name)')
    .in('work_order_id', ids);
  if (error) {
    if (isMissingTable(error)) return { storage: 'none', receipts };
    throw new Error(error.message);
  }
  for (const r of data ?? []) {
    const receiver = (Array.isArray(r.receiver) ? r.receiver[0] : r.receiver) as { name?: string } | null;
    receipts.set(r.work_order_id as string, { received_at: r.received_at as string, received_by_name: receiver?.name ?? null });
  }
  return { storage: 'db', receipts };
}

/** 아직 수신 확인을 안 한 오창공장 진행 건수 — 사이드바 숫자. 표가 없으면 0 */
export async function unreceivedCount(supabase: SupabaseClient): Promise<number> {
  const open = () => supabase.from('dgflow_work_orders').select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'in_progress']).eq('production_site', 'ochang');
  const [{ count: total }, { count: received, error }] = await Promise.all([
    open(),
    supabase.from(RECEIPTS_TABLE)
      // head 요청은 표가 없어도 오류가 비어서 온다 — 한 줄을 읽어 표가 있는지도 함께 본다
      .select('work_order_id, wo:dgflow_work_orders!inner(status, production_site)', { count: 'exact' })
      .in('wo.status', ['pending', 'in_progress']).eq('wo.production_site', 'ochang').limit(1),
  ]);
  if (error) return 0;
  return Math.max(0, (total ?? 0) - (received ?? 0));
}

/** 한국 시간으로 "2026-11-06 14:20" */
export function formatKst(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`;
}
