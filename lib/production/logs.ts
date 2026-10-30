import type { SupabaseClient } from '@supabase/supabase-js';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import type { ProductionLogRow } from './daily-report';

const PAGE = 1000;

/**
 * 기간(양 끝 포함)의 생산 기록 — 품목 · 작업의뢰서 · 거래처 · 입력자를 붙여서.
 * 작업의뢰서 품목은 anon 세션으로 조회가 막히므로 권한을 확인한 뒤 서비스 키 클라이언트로 부른다.
 * 일간 생산일지(기간 합계)와 복층생산일지가 함께 쓴다.
 */
export async function fetchProductionLogs(supabase: SupabaseClient, from: string, to: string): Promise<ProductionLogRow[]> {
  const raw: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('dgflow_production_logs')
      .select(`
        production_date, quantity_completed, area_m2, shift, line_number, work_order_id, work_order_item_id,
        item:dgflow_work_order_items(product_name, width_mm, height_mm, sort_order),
        work_order:dgflow_work_orders(
          work_order_number, customer_label, site_label,
          order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name))
        ),
        creator:dgflow_users!created_by(name)
      `)
      .gte('production_date', from)
      .lte('production_date', to)
      .order('production_date')
      .order('created_at')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    raw.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  return raw.map((r) => {
    const item = one(r.item) as { product_name?: string; width_mm?: number; height_mm?: number; sort_order?: number } | null;
    const wo = one(r.work_order) as (WorkOrderLabelSource & { work_order_number?: string }) | null;
    const labels = wo ? workOrderLabels(wo) : { customer: null, site: null };
    return {
      production_date: r.production_date as string,
      quantity_completed: r.quantity_completed as number,
      area_m2: r.area_m2 as number | null,
      shift: r.shift as string | null,
      line_number: r.line_number as number | null,
      work_order_id: r.work_order_id as string,
      work_order_item_id: r.work_order_item_id as string | null,
      work_order_number: wo?.work_order_number ?? '-',
      customer: labels.customer,
      site: labels.site,
      product_name: item?.product_name ?? '(품목 없음)',
      width_mm: item?.width_mm ?? null,
      height_mm: item?.height_mm ?? null,
      sort_order: item?.sort_order ?? null,
      created_by_name: (one(r.creator) as { name?: string } | null)?.name ?? null,
    };
  });
}

/** Supabase 조인은 타입상 배열로 올 수 있다 — 하나만 쓴다 */
function one(v: unknown) {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}
