import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 작업의뢰서의 현장 담당자 — 그 의뢰서가 이어진 발주 건을 올린 사람(공사개발부 담당).
 * 2026-10-30 회의 · 워드 8번: "생산현황에 현장 담당자 정보가 있으면 — 누구 건인지 물어볼 때 데이터를 뒤져야 한다".
 * 발주 건과 이어지지 않은(ERP 에서 바로 등록한) 의뢰서는 담당자가 없다.
 * 발주 건 표는 권한이 있어야 읽히므로 서비스 키 클라이언트로 부른다.
 */
export interface SiteContact {
  name: string;
  phone: string | null;
  department: string | null;
  intake_number: string;
}

export async function contactsForWorkOrders(supabase: SupabaseClient, workOrderIds: string[]): Promise<Map<string, SiteContact>> {
  const out = new Map<string, SiteContact>();
  if (workOrderIds.length === 0) return out;
  for (let i = 0; i < workOrderIds.length; i += 200) {
    const { data } = await supabase
      .from('dgflow_purchase_order_packages')
      .select('work_order_id, purchase_order:dgflow_purchase_orders(intake_number, creator:dgflow_users!created_by(name, phone, department))')
      .in('work_order_id', workOrderIds.slice(i, i + 200));
    for (const row of data ?? []) {
      const po = one(row.purchase_order) as { intake_number?: string; creator?: unknown } | null;
      const creator = one(po?.creator) as { name?: string; phone?: string | null; department?: string | null } | null;
      if (row.work_order_id && creator?.name && !out.has(row.work_order_id as string)) {
        out.set(row.work_order_id as string, {
          name: creator.name, phone: creator.phone ?? null, department: creator.department ?? null, intake_number: po?.intake_number ?? '',
        });
      }
    }
  }
  return out;
}

function one(v: unknown) {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}
