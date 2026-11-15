import type { SupabaseClient } from '@supabase/supabase-js';
import { expectedArea } from '@/lib/work-order/verify';
import { isMissingTable } from './bokcheung-store';
import type { ProductionLogRow } from './daily-report';
import { MES_TABLE, groupQty, type MesGroup } from './mes';

/**
 * MES 실적 표(dgflow_mes_production) 읽고 쓰기 — 생산일지가 생산 기록과 함께 쓴다 (2026-11-15).
 *
 * 생산일지에서 MES 줄은 작업의뢰서 자리에 "mes:의뢰번호" 를 쓴다(복층일지 종류 · 수량외 열쇠도 이것).
 * 작업의뢰서가 시스템에 등록돼 그날 생산을 손으로 입력했으면 그 의뢰번호 · 날짜의 MES 줄은 빼고 손 입력을 쓴다 —
 * 같은 유리를 두 번 세지 않게. (앞으로 3–4주는 이사님이 등록한 의뢰서로 생산관리부가 직접 입력한다 — 11/13 회의)
 */

export const MES_WORK_ORDER_PREFIX = 'mes:';
export const mesWorkOrderId = (wo: string) => `${MES_WORK_ORDER_PREFIX}${wo}`;
export const isMesWorkOrderId = (id: string) => id.startsWith(MES_WORK_ORDER_PREFIX);

export interface MesRow {
  production_date: string;
  line_number: number;
  shift: 'day' | 'night';
  work_order_number: string;
  item_no: number;
  product_name: string;
  width_mm: number | null;
  height_mm: number | null;
  customer: string;
  site: string;
  remark: string;
  scanned: number;
  filled: number;
  quantity: number;
  area_m2: number;
}

/** 묶음 → 표 한 줄. 면적은 작업의뢰서와 같은 규칙(장당 둘째 자리 반올림, 최소 0.28M²) */
export function toMesRow(g: MesGroup): MesRow {
  const quantity = groupQty(g);
  return {
    production_date: g.date,
    line_number: g.line,
    shift: g.shift,
    work_order_number: g.wo,
    item_no: g.no,
    product_name: g.product.slice(0, 200),
    width_mm: g.width || null,
    height_mm: g.height || null,
    customer: g.customer.slice(0, 200),
    site: g.site.slice(0, 300),
    remark: g.remark.slice(0, 300),
    scanned: g.scanned,
    filled: g.filled,
    quantity,
    area_m2: g.width && g.height ? expectedArea(g.width, g.height, quantity) : 0,
  };
}

/** 표 한 줄 → 생산일지가 읽는 생산 기록 모양 */
export function mesToLog(r: MesRow): ProductionLogRow {
  return {
    production_date: r.production_date,
    quantity_completed: r.quantity,
    area_m2: Number(r.area_m2 || 0),
    shift: r.shift,
    line_number: r.line_number,
    work_order_id: mesWorkOrderId(r.work_order_number),
    work_order_item_id: `${mesWorkOrderId(r.work_order_number)}:${r.item_no}`,
    work_order_number: r.work_order_number,
    customer: r.customer || null,
    site: r.site || null,
    product_name: r.product_name || '(품명 없음)',
    width_mm: r.width_mm,
    height_mm: r.height_mm,
    sort_order: r.item_no - 1,
    created_by_name: 'MES',
  };
}

/**
 * 손 입력과 겹치는 MES 줄을 뺀다 — 같은 의뢰번호 · 같은 날에 손으로 넣은 생산 기록이 있으면 MES 줄을 쓰지 않는다.
 */
export function withoutManualOverlap(mes: MesRow[], manual: Pick<ProductionLogRow, 'work_order_number' | 'production_date'>[]): MesRow[] {
  const taken = new Set(manual.map(l => `${l.work_order_number}|${l.production_date}`));
  return mes.filter(r => !taken.has(`${r.work_order_number}|${r.production_date}`));
}

const COLUMNS = 'production_date, line_number, shift, work_order_number, item_no, product_name, width_mm, height_mm, customer, site, remark, scanned, filled, quantity, area_m2';

/** 기간(양 끝 포함)의 MES 줄 — 표가 아직 없으면 빈 목록 */
export async function fetchMesRows(supabase: SupabaseClient, from: string, to: string): Promise<MesRow[]> {
  const out: MesRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from(MES_TABLE).select(COLUMNS)
      .gte('production_date', from).lte('production_date', to)
      .order('production_date').order('line_number').order('work_order_number').order('item_no').order('shift')
      .range(offset, offset + 999);
    if (error) {
      if (isMissingTable(error)) return [];
      throw new Error(error.message);
    }
    out.push(...((data ?? []) as MesRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** 날짜별 MES 합계 (누계용) — 표가 없으면 빈 목록 */
export async function fetchMesDailyTotals(supabase: SupabaseClient, from: string, to: string): Promise<{ date: string; quantity: number; area_m2: number }[]> {
  const { data, error } = await supabase.from('dgflow_mes_daily_totals').select('production_date, quantity, area_m2')
    .gte('production_date', from).lte('production_date', to).order('production_date').limit(2000);
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(d => ({ date: d.production_date as string, quantity: Number(d.quantity) || 0, area_m2: Number(d.area_m2) || 0 }));
}
