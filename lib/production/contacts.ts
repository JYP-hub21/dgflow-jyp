import type { SupabaseClient } from '@supabase/supabase-js';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';

/**
 * 작업의뢰서의 공사 담당자(공사개발부) — 생산 현황 · 생산 입력에서 "누구에게 물어볼지".
 * 2026-10-30 회의 · 워드 8번, 2026-11-02 "현장별 공사관리부 담당자 정보 — 복층 입력할 때".
 *
 * 찾는 순서
 *  1. 그 의뢰서와 이어진 발주 건을 올린 사람 (source 'po')
 *  2. 그 현장에 정해 둔 담당자 — 표 dgflow_site_contacts (마이그레이션 022, source 'site').
 *     작업의뢰서 대부분은 ERP 로 바로 등록해 발주 건과 이어지지 않아서, 현장마다 한 번 정해 두면 그 현장 의뢰서 전부에 뜬다.
 * 발주 건 표는 권한이 있어야 읽히므로 서비스 키 클라이언트로 부른다.
 */
export interface SiteContact {
  name: string;
  phone: string | null;
  department: string | null;
  intake_number: string;
  source: 'po' | 'site';
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
          name: creator.name, phone: creator.phone ?? null, department: creator.department ?? null,
          intake_number: po?.intake_number ?? '', source: 'po',
        });
      }
    }
  }

  // 발주 건이 없는 의뢰서는 현장 담당자로
  const missing = workOrderIds.filter(id => !out.has(id));
  if (missing.length === 0) return out;
  const siteOf = await siteLabelsOf(supabase, missing);
  const labels = [...new Set(siteOf.values())];
  if (labels.length === 0) return out;
  const bySite = await siteContacts(supabase, labels);
  for (const [id, label] of siteOf) {
    const c = bySite.get(label);
    if (c) out.set(id, c);
  }
  return out;
}

/** 작업의뢰서 → 현장명 (화면에 보이는 현장명 그대로 — workOrderLabels) */
export async function siteLabelsOf(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from('dgflow_work_orders')
      .select('id, customer_label, site_label, order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name))')
      .in('id', ids.slice(i, i + 200));
    for (const w of data ?? []) {
      const site = workOrderLabels(w as unknown as WorkOrderLabelSource).site?.trim();
      if (site) out.set(w.id as string, site);
    }
  }
  return out;
}

/** 현장명 → 정해 둔 담당자 (표가 아직 없으면 빈 결과) */
async function siteContacts(supabase: SupabaseClient, labels: string[]): Promise<Map<string, SiteContact>> {
  const out = new Map<string, SiteContact>();
  const { data, error } = await supabase
    .from('dgflow_site_contacts')
    .select('site_label, user:dgflow_users!dgflow_site_contacts_user_id_fkey(name, phone, department)')
    .in('site_label', labels);
  if (error) return out;
  for (const row of data ?? []) {
    const u = one(row.user) as { name?: string; phone?: string | null; department?: string | null } | null;
    if (u?.name) out.set(row.site_label as string, { name: u.name, phone: u.phone ?? null, department: u.department ?? null, intake_number: '', source: 'site' });
  }
  return out;
}

function one(v: unknown) {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}
