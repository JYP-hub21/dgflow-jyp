import type { SupabaseClient } from '@supabase/supabase-js';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import type { ProductionLogRow } from './daily-report';
import { fetchMesDailyTotals, fetchMesRows, mesToLog, withoutManualOverlap } from './mes-db';

const PAGE = 1000;

/**
 * 기간(양 끝 포함)의 생산 기록 + MES 실적 (2026-11-15) — 생산일지(일간 · 복층 · 주간)가 함께 쓴다.
 * MES 실적은 작업의뢰서 없이 들어온 바코드 기록이다(lib/production/mes-db.ts). 같은 의뢰번호 · 날짜에 손 입력이 있으면 손 입력을 쓴다.
 * detailFrom 을 주면 그 앞날의 MES 는 날짜별 합계 한 줄씩만 읽는다 — 복층일지 누계(1월 1일부터)를 빨리 내려고.
 */
export async function fetchProductionLogs(
  supabase: SupabaseClient, from: string, to: string, opts: { detailFrom?: string } = {},
): Promise<ProductionLogRow[]> {
  const detailFrom = opts.detailFrom && opts.detailFrom > from ? opts.detailFrom : from;
  const [manual, mes, totals] = await Promise.all([
    fetchManualLogs(supabase, from, to),
    fetchMesRows(supabase, detailFrom, to),
    detailFrom > from ? fetchMesDailyTotals(supabase, from, dayBefore(detailFrom)) : Promise.resolve([]),
  ]);
  const merged = [
    ...manual,
    ...withoutManualOverlap(mes, manual).map(mesToLog),
    ...totals.map((t): ProductionLogRow => ({
      production_date: t.date, quantity_completed: t.quantity, area_m2: t.area_m2, shift: null, line_number: null,
      work_order_id: 'mes:total', work_order_item_id: null, work_order_number: '-', customer: null, site: null,
      product_name: '복층 합계 (MES)', width_mm: null, height_mm: null, sort_order: null, created_by_name: 'MES', insulated_total: true,
    })),
  ];
  // 날짜순 (같은 날 안에서는 손 입력 → MES 순서를 그대로 둔다)
  return merged.map((l, i) => ({ l, i })).sort((a, b) => a.l.production_date.localeCompare(b.l.production_date) || a.i - b.i).map(x => x.l);
}

const dayBefore = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** 생산 기록(손 입력 · 작업의뢰서 품목에 붙은 것)만 */
async function fetchManualLogs(supabase: SupabaseClient, from: string, to: string): Promise<ProductionLogRow[]> {
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
