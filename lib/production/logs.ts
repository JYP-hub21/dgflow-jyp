import type { SupabaseClient } from '@supabase/supabase-js';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import type { ProductionLogRow } from './daily-report';
import { fetchMesLightRows, fetchMesRows, fetchSystemOrderNumbers, mesToLog, netDailyTotals, withoutManualOverlap } from './mes-db';
import { MES_TABLE } from './mes';

const PAGE = 1000;
const PARALLEL = 8;

/**
 * 기간(양 끝 포함)의 생산 기록 + MES 실적 (2026-11-15) — 생산일지(일간 · 복층 · 주간)가 함께 쓴다.
 * MES 실적은 작업의뢰서 없이 들어온 바코드 기록이다(lib/production/mes-db.ts). 같은 의뢰번호 · 날짜에 손 입력이 있으면 손 입력을 쓴다.
 * 시스템에 작업의뢰서가 있는 의뢰번호는 생산 기록이 원본이라 그 번호의 MES 줄은 날짜와 상관없이 쓰지 않는다
 * (화면에서 고친 수량이 일지에 그대로 나오게 · 손 입력과 MES 를 두 번 세지 않게).
 * detailFrom 을 주면 그 앞날의 MES 는 날짜별 합계 한 줄씩으로 줄인다 — 복층일지 누계(1월 1일부터)용.
 * 이 합계에서도 생산 기록과 겹치는 (의뢰번호 · 날짜)는 뺀다 — MES 로 만든 작업의뢰서는 같은 유리가 생산 기록에도 있어
 * 그대로 더하면 누계가 두 번 세어진다 (2026-11-16 실전 전 점검에서 발견).
 */
export async function fetchProductionLogs(
  supabase: SupabaseClient, from: string, to: string, opts: { detailFrom?: string } = {},
): Promise<ProductionLogRow[]> {
  const detailFrom = opts.detailFrom && opts.detailFrom > from ? opts.detailFrom : from;
  const [manual, mes, early, inSystem] = await Promise.all([
    fetchManualLogs(supabase, from, to),
    fetchMesRows(supabase, detailFrom, to),
    detailFrom > from ? fetchMesLightRows(supabase, from, dayBefore(detailFrom)) : Promise.resolve([]),
    fetchSystemOrderNumbers(supabase),
  ]);
  const totals = netDailyTotals(early, manual, inSystem);
  const merged = [
    ...manual,
    ...withoutManualOverlap(mes, manual, inSystem).map(mesToLog),
    ...totals.map((t): ProductionLogRow => ({
      production_date: t.date, quantity_completed: t.quantity, area_m2: t.area_m2, shift: null, line_number: null,
      work_order_id: 'mes:total', work_order_item_id: null, work_order_number: '-', customer: null, site: null,
      product_name: '복층 합계 (MES)', width_mm: null, height_mm: null, sort_order: null, created_by_name: 'MES', insulated_total: true,
    })),
  ];
  // 날짜순 (같은 날 안에서는 손 입력 → MES 순서를 그대로 둔다)
  return merged.map((l, i) => ({ l, i })).sort((a, b) => a.l.production_date.localeCompare(b.l.production_date) || a.i - b.i).map(x => x.l);
}

/**
 * 이날까지(이날 포함) 생산 기록이나 MES 실적이 있는 마지막 날 — 일지를 빈 날짜로 열었을 때 그날로 바로 가게 (2026-11-16 사용자
 * "왜 작업의뢰서에만 들어가 있고 일지에서는 확인할 수가 없냐" — MES 파일이 11/11 까지라 오늘 날짜 일지가 비어 보였다).
 */
export async function lastProductionDate(supabase: SupabaseClient, onOrBefore: string): Promise<string | null> {
  const [manual, mes] = await Promise.all([
    supabase.from('dgflow_production_logs').select('production_date')
      .lte('production_date', onOrBefore).order('production_date', { ascending: false }).limit(1),
    supabase.from(MES_TABLE).select('production_date')
      .lte('production_date', onOrBefore).order('production_date', { ascending: false }).limit(1),
  ]);
  const dates = [manual, mes]
    .map(r => (r.error ? null : (r.data?.[0] as { production_date?: string } | undefined)?.production_date ?? null))
    .filter((d): d is string => !!d)
    .sort();
  return dates.at(-1) ?? null;
}

const dayBefore = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** 생산 기록(손 입력 · 작업의뢰서 품목에 붙은 것)만 */
async function fetchManualLogs(supabase: SupabaseClient, from: string, to: string): Promise<ProductionLogRow[]> {
  const page = (offset: number) => supabase
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
    // 한꺼번에 등록한 기록(MES)은 등록 시각이 같다 — id 까지 걸어야 나눠 읽을 때 같은 줄이 겹치거나 빠지지 않는다
    // (2026-11-16: 2,311줄에서 2줄이 겹치고 2줄이 빠져 합계가 3조 틀렸다)
    .order('id')
    .range(offset, offset + PAGE - 1);

  // 줄 수를 먼저 세고 여러 쪽을 한꺼번에 읽는다 — 누계는 1월 1일부터 읽어, MES 를 전부 넣으면 2만 줄이 넘는다
  const { count, error: countError } = await supabase.from('dgflow_production_logs')
    .select('id', { count: 'exact', head: true }).gte('production_date', from).lte('production_date', to);
  if (countError) throw new Error(countError.message);
  const pages = Math.ceil((count ?? 0) / PAGE);
  const raw: Record<string, unknown>[] = [];
  let lastLength = 0;
  for (let start = 0; start < pages; start += PARALLEL) {
    const batch = await Promise.all(Array.from({ length: Math.min(PARALLEL, pages - start) }, (_, i) => page((start + i) * PAGE)));
    for (const { data, error } of batch) {
      if (error) throw new Error(error.message);
      raw.push(...(data ?? []));
      lastLength = data?.length ?? 0;
    }
  }
  // 세는 사이에 기록이 늘었으면(마지막 쪽이 꽉 참) 끝까지 이어 읽는다
  for (let offset = pages * PAGE; pages === 0 || lastLength === PAGE; offset += PAGE) {
    const { data, error } = await page(offset);
    if (error) throw new Error(error.message);
    raw.push(...(data ?? []));
    lastLength = data?.length ?? 0;
    if (lastLength < PAGE) break;
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
