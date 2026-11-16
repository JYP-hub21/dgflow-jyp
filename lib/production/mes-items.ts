import type { SupabaseClient } from '@supabase/supabase-js';
import { expectedArea } from '@/lib/work-order/verify';
import { proRataArea, syncProducedQuantity } from './produced-quantity';
import { setMesItemQuantity } from './mes-quantity';
import { itemNo } from './item-view';

/**
 * MES 로 만든 작업의뢰서의 품목 고치기 — 수량 · 품명 · 규격 수정, 품목 추가, 품목 삭제 (2026-11-16 사용자
 * "새로운 품목 추가나 이런 것도 되게 … 작업의뢰서에서도 반영되고 넘버도 추가될 수 있고").
 *
 * MES 바코드가 한 장도 안 찍힌 NO 는 품목이 아예 없다(상세 화면이 "No.1, 5 는 품목이 없습니다" 로 알린다) — 그 품목을 여기서 더한다.
 * 규칙:
 *  - 수량을 고치면 생산 기록도 함께 맞춘다 (lib/production/mes-quantity.ts 와 같은 규칙).
 *  - 더하는 품목은 생산일을 적으면 그날 만든 것으로 기록하고(의뢰 = 생산), 비우면 아직 안 만든 것으로 둔다.
 *  - 납품 기록이 있는 품목은 지우지 않는다. 품목을 전부 지울 수는 없다(그때는 작업의뢰서를 삭제한다).
 *  - 번호(No)는 겹칠 수 없고, 목록은 늘 번호 순서로 다시 줄 세운다.
 */

export interface MesItemRow {
  id: string;
  item_no: number | null;
  sort_order: number | null;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  area_m2: number | string | null;
}

export interface MesItemUpdate { id: string; quantity?: number; product_name?: string; width_mm?: number; height_mm?: number }
export interface MesItemAdd {
  item_no: number; product_name: string; width_mm: number; height_mm: number; quantity: number;
  /** 만든 날 — 없으면 아직 안 만든 품목 */
  produced_date: string | null;
  line_number: number;
  shift: 'day' | 'night';
}
export interface MesItemsPlan { update: MesItemUpdate[]; add: MesItemAdd[]; remove: string[] }

const MAX_QTY = 100_000;
const MAX_MM = 20_000;
const MAX_NO = 9_999;
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * 요청을 검사해 실행할 내용으로 정리한다. 틀리면 { error } — 아무것도 바꾸기 전에 전부 걸러낸다.
 * today: 한국 날짜(생산일은 내일 이후일 수 없다).
 */
export function planMesItems(existing: MesItemRow[], body: unknown, today: string): { plan: MesItemsPlan } | { error: string } {
  const b = (body ?? {}) as { update?: unknown; add?: unknown; remove?: unknown };
  const byId = new Map(existing.map(i => [i.id, i]));
  const noOf = new Map(existing.map((i, k) => [i.id, itemNo(i, k)]));

  const remove: string[] = [];
  for (const id of Array.isArray(b.remove) ? b.remove : []) {
    if (typeof id !== 'string' || !byId.has(id)) return { error: '이 작업의뢰서의 품목이 아닙니다.' };
    if (!remove.includes(id)) remove.push(id);
  }
  const removed = new Set(remove);

  const update: MesItemUpdate[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(b.update) ? b.update : []) {
    const u = (raw ?? {}) as Record<string, unknown>;
    const cur = typeof u.id === 'string' ? byId.get(u.id) : undefined;
    if (!cur) return { error: '이 작업의뢰서의 품목이 아닙니다.' };
    if (removed.has(cur.id) || seen.has(cur.id)) continue;
    seen.add(cur.id);
    const no = noOf.get(cur.id);
    const out: MesItemUpdate = { id: cur.id };
    if (u.quantity !== undefined) {
      if (!isInt(u.quantity, 1, MAX_QTY)) return { error: `No.${no} — 수량은 1 이상의 정수여야 합니다.` };
      if (u.quantity !== cur.quantity) out.quantity = u.quantity;
    }
    if (u.product_name !== undefined) {
      const name = typeof u.product_name === 'string' ? u.product_name.trim() : '';
      if (!name || name.length > 200) return { error: `No.${no} — 품명을 입력하세요(200자까지).` };
      if (name !== cur.product_name) out.product_name = name;
    }
    for (const k of ['width_mm', 'height_mm'] as const) {
      if (u[k] === undefined) continue;
      if (!isInt(u[k], 1, MAX_MM)) return { error: `No.${no} — 가로 · 세로는 1 이상의 정수(mm)여야 합니다.` };
      if (u[k] !== cur[k]) out[k] = u[k] as number;
    }
    if (Object.keys(out).length > 1) update.push(out);
  }

  const add: MesItemAdd[] = [];
  const takenNos = new Set(existing.filter(i => !removed.has(i.id)).map(i => noOf.get(i.id)!));
  for (const raw of Array.isArray(b.add) ? b.add : []) {
    const a = (raw ?? {}) as Record<string, unknown>;
    if (!isInt(a.item_no, 1, MAX_NO)) return { error: '더할 품목의 No 는 1 이상의 정수여야 합니다.' };
    if (takenNos.has(a.item_no)) return { error: `No.${a.item_no} 은(는) 이미 있습니다. 다른 번호를 쓰세요.` };
    takenNos.add(a.item_no);
    const name = typeof a.product_name === 'string' ? a.product_name.trim() : '';
    if (!name || name.length > 200) return { error: `No.${a.item_no} — 품명을 입력하세요(200자까지).` };
    if (!isInt(a.width_mm, 1, MAX_MM) || !isInt(a.height_mm, 1, MAX_MM)) return { error: `No.${a.item_no} — 가로 · 세로를 mm 로 입력하세요.` };
    if (!isInt(a.quantity, 1, MAX_QTY)) return { error: `No.${a.item_no} — 수량은 1 이상의 정수여야 합니다.` };
    let produced: string | null = null;
    if (a.produced_date !== undefined && a.produced_date !== null && a.produced_date !== '') {
      if (!isDate(a.produced_date)) return { error: `No.${a.item_no} — 생산일은 날짜(YYYY-MM-DD)로 입력하세요.` };
      if (a.produced_date > today) return { error: `No.${a.item_no} — 생산일은 오늘보다 뒤일 수 없습니다.` };
      produced = a.produced_date;
    }
    add.push({
      item_no: a.item_no, product_name: name, width_mm: a.width_mm, height_mm: a.height_mm, quantity: a.quantity,
      produced_date: produced,
      line_number: isInt(a.line_number, 1, 99) ? a.line_number : 1,
      shift: a.shift === 'night' ? 'night' : 'day',
    });
  }

  if (update.length === 0 && add.length === 0 && remove.length === 0) return { error: '바꿀 내용이 없습니다.' };
  if (existing.length - remove.length + add.length < 1) return { error: '품목을 전부 지울 수는 없습니다. 작업의뢰서를 삭제하세요.' };
  return { plan: { update, add, remove } };
}

/** 정리한 내용을 실제로 적용한다. 돌려주는 값: 바뀐 건수 */
export async function applyMesItems(
  supabase: SupabaseClient, workOrderId: string, existing: MesItemRow[], plan: MesItemsPlan, userId: string,
): Promise<{ updated: number; added: number; removed: number }> {
  const byId = new Map(existing.map(i => [i.id, i]));

  // 1) 삭제 — 납품 기록이 있으면 멈춘다(생산 기록은 품목과 함께 지워진다)
  if (plan.remove.length > 0) {
    const { count, error } = await supabase.from('dgflow_delivery_logs').select('id', { count: 'exact', head: true }).in('work_order_item_id', plan.remove);
    if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(error.message);
    if ((count ?? 0) > 0) throw new Error('납품 기록이 있는 품목은 지울 수 없습니다. 납품 기록을 먼저 지우세요.');
    const { error: delError } = await supabase.from('dgflow_work_order_items').delete().in('id', plan.remove).eq('work_order_id', workOrderId);
    if (delError) throw new Error(delError.message);
  }

  // 2) 수정 — 품명 · 규격을 먼저, 그다음 수량(생산 기록과 함께)
  for (const u of plan.update) {
    const cur = byId.get(u.id)!;
    const sized = { ...cur, product_name: u.product_name ?? cur.product_name, width_mm: u.width_mm ?? cur.width_mm, height_mm: u.height_mm ?? cur.height_mm };
    const sizeChanged = sized.width_mm !== cur.width_mm || sized.height_mm !== cur.height_mm;
    if (u.product_name !== undefined || sizeChanged) {
      const area = sizeChanged ? expectedArea(sized.width_mm, sized.height_mm, cur.quantity) : cur.area_m2;
      const { error } = await supabase.from('dgflow_work_order_items')
        .update({ product_name: sized.product_name, width_mm: sized.width_mm, height_mm: sized.height_mm, area_m2: area }).eq('id', u.id);
      if (error) throw new Error(error.message);
      if (sizeChanged) {      // 규격이 바뀌면 그 품목 생산 기록의 면적도 새 규격으로
        const { data: logs, error: logError } = await supabase.from('dgflow_production_logs').select('id, quantity_completed').eq('work_order_item_id', u.id);
        if (logError) throw new Error(logError.message);
        const after = { ...sized, area_m2: area };
        for (const l of logs ?? []) {
          const { error: e } = await supabase.from('dgflow_production_logs')
            .update({ area_m2: proRataArea(after, l.quantity_completed as number) }).eq('id', l.id);
          if (e) throw new Error(e.message);
        }
      }
    }
    if (u.quantity !== undefined) await setMesItemQuantity(supabase, u.id, u.quantity);
  }

  // 3) 추가 — 생산일이 있으면 그날 만든 것으로 기록한다
  for (const a of plan.add) {
    const area = expectedArea(a.width_mm, a.height_mm, a.quantity);
    const { data: row, error } = await supabase.from('dgflow_work_order_items').insert({
      work_order_id: workOrderId, product_name: a.product_name, width_mm: a.width_mm, height_mm: a.height_mm,
      quantity: a.quantity, area_m2: area, produced_quantity: 0, item_no: a.item_no, sort_order: a.item_no - 1,
    }).select('id').single();
    if (error || !row) throw new Error(error?.message ?? '품목을 더하지 못했습니다.');
    if (a.produced_date) {
      const { error: logError } = await supabase.from('dgflow_production_logs').insert({
        work_order_id: workOrderId, work_order_item_id: row.id, production_date: a.produced_date, log_type: 'partial',
        quantity_completed: a.quantity, area_m2: area, shift: a.shift, line_number: a.line_number, remark: '품목 수정에서 추가', created_by: userId,
      });
      if (logError) throw new Error(logError.message);
      await syncProducedQuantity(supabase, row.id as string);
    }
  }

  // 4) 번호 순서로 다시 줄 세운다 — 더하거나 지웠을 때만
  if (plan.add.length > 0 || plan.remove.length > 0) {
    const { data: rows, error } = await supabase.from('dgflow_work_order_items').select('id, item_no, sort_order').eq('work_order_id', workOrderId).order('sort_order').order('id');
    if (error) throw new Error(error.message);
    const sorted = (rows ?? []).map((r, k) => ({ id: r.id as string, sort: r.sort_order as number | null, no: itemNo(r as { item_no: number | null; sort_order: number | null }, k) }))
      .sort((x, y) => x.no - y.no);
    for (let k = 0; k < sorted.length; k++) {
      if (sorted[k].sort === k) continue;
      const { error: e } = await supabase.from('dgflow_work_order_items').update({ sort_order: k }).eq('id', sorted[k].id);
      if (e) throw new Error(e.message);
    }
  }

  await supabase.from('dgflow_work_orders').update({ updated_at: new Date().toISOString() }).eq('id', workOrderId);
  return { updated: plan.update.length, added: plan.add.length, removed: plan.remove.length };
}
