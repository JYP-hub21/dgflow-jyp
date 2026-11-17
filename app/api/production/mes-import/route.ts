import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isIsoDate } from '@/lib/production/daily-report';
import { isMissingTable } from '@/lib/production/bokcheung-store';
import { fetchMesDailyTotals, toMesRow } from '@/lib/production/mes-db';
import { MES_COMMIT_ENABLED, MES_TABLE, normalizeWorkOrderNumber, type MesGroup } from '@/lib/production/mes';
import {
  MES_ORDER_NOTE, logArea, otherKey, planMesOrders, planMesReupload, planOtherOrderMes, type MesOrderItem, type MesOrderLog, type MesSeenRow,
} from '@/lib/production/mes-orders';

/** MES 가져오기가 넣은 생산 기록의 비고 — 손 입력과 가른다 */
const MES_LOG_REMARK = 'MES 바코드';
import { itemNo } from '@/lib/production/item-view';
import { syncProducedQuantity } from '@/lib/production/produced-quantity';
import { syncWorkOrderStatus } from '@/lib/work-order/stage';
import { expectedArea } from '@/lib/work-order/verify';
import { fetchAllIn } from '@/lib/supabase/fetch-all';
import { RECEIPTS_TABLE } from '@/lib/work-order/receipts';

/** 작업의뢰서 만들기는 의뢰번호 단위로 — 한 번에 의뢰서 이만큼 · 줄 이만큼 */
const MAX_ORDER_NUMBERS = 80;
const MAX_ORDER_GROUPS = 8000;

/**
 * MES 생산실적 → 지난 작업의뢰서 · 생산 기록 · MES 실적 표 (lib/production/mes.ts · mes-db.ts · mes-orders.ts).
 *
 *   GET                                   → 지금 표에 들어 있는 MES 실적 (기간 · 장수 · 마지막 등록)
 *   POST { mode: 'clear', from, to }      → 그 기간 MES 실적을 지운다
 *   POST { mode: 'orders', file, from, to, groups } → 의뢰번호 단위로 나눠 보낸다.
 *        1) 없는 의뢰번호는 새 작업의뢰서(상태 완료) · 품목 · 생산 기록을 만든다.
 *        2) MES 로 만든 의뢰서가 이미 있으면 지난번에 올린 내용(MES 실적 표)과 견주어 달라진 것만 넣는다 —
 *           화면에서 고친 수량 · 지운 품목은 다시 올려도 그대로다 (planMesReupload, 2026-11-17).
 *        3) 그 밖의 의뢰서(등록 화면 · 지난 의뢰서 가져오기)는 손으로 넣은 생산이 있는 품목은 건드리지 않고, 없는 품목만 의뢰 수량까지
 *           붙인다 — 손 입력과 MES 가 같은 유리를 두 번 세지 않게 (planOtherOrderMes, 2026-11-17 · 11/16 점검 P3).
 *        4) 끝으로 기간(from–to) 안의 줄을 MES 실적 표에 덮어쓴다. 이 표가 "지난번에 올린 내용" 이라, 반드시 2) 뒤에 쓴다.
 * 생산 입력 권한이 있어야 한다.
 */
async function guard() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!hasPermission(user, 'production:input')) {
    return { error: NextResponse.json({ error: '생산 실적을 입력할 권한이 없습니다.' }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const g = await guard();
  if ('error' in g) return g.error;
  const supabase = createServiceRoleClient();
  try {
    const days = await fetchMesDailyTotals(supabase, '2000-01-01', '2999-12-31');
    const { data: last, error } = await supabase.from(MES_TABLE).select('imported_at, source_file')
      .order('imported_at', { ascending: false }).limit(1);
    if (error && !isMissingTable(error)) throw new Error(error.message);
    return NextResponse.json({
      days: days.length,
      from: days[0]?.date ?? null,
      to: days[days.length - 1]?.date ?? null,
      quantity: days.reduce((s, d) => s + d.quantity, 0),
      lastImport: last?.[0] ?? null,
      table: !error,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'MES 실적을 읽지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const g = await guard();
  if ('error' in g) return g.error;
  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();

  if (body?.mode === 'clear') {
    const { from, to } = body;
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) return NextResponse.json({ error: '기간이 올바르지 않습니다.' }, { status: 400 });
    const { error, count } = await supabase.from(MES_TABLE).delete({ count: 'exact' }).gte('production_date', from).lte('production_date', to);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: count ?? 0 });
  }

  if (body?.mode === 'orders') {
    if (!MES_COMMIT_ENABLED) return NextResponse.json({ error: '시험 단계라 아직 등록하지 않습니다.' }, { status: 403 });
    // 생산 입력 권한으로 만든다 — 이미 생산이 끝난 MES 기록이라 작업의뢰서 등록 권한까지 묻지 않는다
    const groups = parseGroups(body.groups, MAX_ORDER_GROUPS);
    if (typeof groups === 'string') return NextResponse.json({ error: groups }, { status: 400 });
    if (new Set(groups.map(x => x.wo)).size > MAX_ORDER_NUMBERS) {
      return NextResponse.json({ error: `한 번에 의뢰번호 ${MAX_ORDER_NUMBERS}건까지 보낼 수 있습니다.` }, { status: 400 });
    }
    // 기간이 없으면 받은 줄 전부를 표에 쓴다
    const from = isIsoDate(body.from) ? body.from as string : '0000-01-01';
    const to = isIsoDate(body.to) ? body.to as string : '9999-12-31';
    const file = String(body.file ?? '').trim().slice(0, 200) || null;
    try {
      const made = await createOrders(supabase, groups, g.user.id, file);
      const saved = await saveSeen(supabase, groups.filter(x => x.date >= from && x.date <= to), g.user.id, file);
      return NextResponse.json({ ...made, ...saved });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : '작업의뢰서를 만들지 못했습니다.' }, { status: 500 });
    }
  }

  // 예전 화면은 MES 실적 표부터 썼다('commit'). 표가 "지난번에 올린 내용" 이 된 뒤로는 그 순서면 새 생산을 놓친다 — 새 화면으로 다시 올리게 한다
  if (body?.mode === 'commit') {
    return NextResponse.json({ error: '화면이 예전 것입니다. 새로 고침(F5)한 뒤 다시 올려 주세요.' }, { status: 409 });
  }
  return NextResponse.json({ error: '요청을 알아보지 못했습니다.' }, { status: 400 });
}

const SEEN_KEY = 'production_date,line_number,shift,work_order_number,item_no';

/** MES 실적 표에 덮어쓴다 — 생산일지의 MES 줄이자, 다음에 다시 올릴 때 견줄 "지난번에 올린 내용" */
async function saveSeen(supabase: Db, groups: MesGroup[], userId: string, file: string | null) {
  const now = new Date().toISOString();
  const rows = groups.map(x => ({ ...toMesRow(x), source_file: file, imported_by: userId, imported_at: now }));
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await supabase.from(MES_TABLE).upsert(rows.slice(i, i + 1000), { onConflict: SEEN_KEY });
    if (error) throw new Error(isMissingTable(error) ? 'MES 실적 표가 아직 없습니다. 관리자에게 알려 주세요.' : error.message);
  }
  return { saved: rows.length, quantity: rows.reduce((s, r) => s + r.quantity, 0) };
}

/** 화면이 보낸 묶음을 다시 확인한다 — 틀리면 까닭 글 */
function parseGroups(input: unknown, max: number): MesGroup[] | string {
  const raw = Array.isArray(input) ? (input as Partial<MesGroup>[]) : [];
  if (raw.length === 0 || raw.length > max) return `한 번에 ${max}줄까지 보낼 수 있습니다.`;
  const str = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
  const out: MesGroup[] = [];
  for (const x of raw) {
    const wo = normalizeWorkOrderNumber(x?.wo);
    const ok = wo && Number.isInteger(x.no) && x.no! > 0 && x.no! < 100_000 && typeof x.date === 'string' && isIsoDate(x.date)
      && Number.isInteger(x.line) && x.line! >= 1 && x.line! <= 99 && (x.shift === 'day' || x.shift === 'night')
      && Number.isInteger(x.scanned) && x.scanned! >= 0 && Number.isInteger(x.filled) && x.filled! >= 0
      && x.scanned! + x.filled! > 0 && x.scanned! + x.filled! <= 100_000
      && Number.isFinite(Number(x.width ?? 0)) && Number.isFinite(Number(x.height ?? 0));
    if (!ok) return '보낸 실적 중 형식이 맞지 않는 줄이 있습니다.';
    out.push({
      wo: wo!, no: x.no!, date: x.date!, line: x.line!, shift: x.shift!, scanned: x.scanned!, filled: x.filled!,
      width: Math.round(Number(x.width) || 0), height: Math.round(Number(x.height) || 0),
      product: str(x.product, 200), customer: str(x.customer, 200), site: str(x.site, 300), remark: str(x.remark, 300),
    });
  }
  return out;
}

type Db = ReturnType<typeof createServiceRoleClient>;
const logKey = (itemId: string, date: string, line: number, shift: string) => `${itemId}|${date}|${line}|${shift}`;

/**
 * 의뢰번호별 작업의뢰서 + 생산 기록 (lib/production/mes-orders.ts).
 * 없는 의뢰번호 → 새 작업의뢰서(완료) · 품목 · 생산 기록.
 * MES 로 만든 의뢰서가 이미 있다 → 지난번에 올린 내용과 견주어 달라진 것만(planMesReupload). 새 NO 는 품목을 더하고,
 *   생산이 의뢰 수량을 넘으면 수량을 늘린다. 사람이 고친 수량 · 지운 품목은 그대로 둔다.
 * 그 밖의 의뢰서 → 손으로 넣은 생산이 있는 품목은 그대로, 없는 품목만 의뢰 수량까지 붙인다(planOtherOrderMes).
 */
async function createOrders(supabase: Db, groups: MesGroup[], userId: string, file: string | null) {
  const plans = planMesOrders(groups);
  const numbers = plans.map(p => p.work_order_number);
  const { data: found, error } = await supabase.from('dgflow_work_orders').select('id, work_order_number, notes').in('work_order_number', numbers);
  if (error) throw new Error(error.message);
  const existing = new Map((found ?? []).map(r => [r.work_order_number as string, r as { id: string; notes: string | null }]));
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const note = `${MES_ORDER_NOTE} ${today} · 수량은 MES 바코드 기준(번호 사이 빈 장 포함)`;

  // ── 새 의뢰서
  const fresh = plans.filter(p => !existing.has(p.work_order_number));
  let created = 0, logsInserted = 0, itemsCreated = 0;
  if (fresh.length > 0) {
    const { data: inserted, error: woError } = await supabase.from('dgflow_work_orders').insert(fresh.map(p => ({
      order_id: null, work_order_number: p.work_order_number, request_date: p.request_date, delivery_date: null,
      customer_label: p.customer, site_label: p.site, notes: note, status: 'completed',
    }))).select('id, work_order_number');
    if (woError) throw new Error(woError.message);
    const idOf = new Map((inserted ?? []).map(r => [r.work_order_number as string, r.id as string]));
    const rollback = () => supabase.from('dgflow_work_orders').delete().in('id', [...idOf.values()]);
    const items = fresh.flatMap(p => p.items.map((it, idx) => ({
      work_order_id: idOf.get(p.work_order_number), product_name: it.product_name, width_mm: it.width_mm, height_mm: it.height_mm,
      quantity: it.quantity, area_m2: it.area_m2, produced_quantity: it.quantity, remark: it.remark, sort_order: idx, item_no: it.no,
    })));
    const { data: insertedItems, error: itemError } = await supabase.from('dgflow_work_order_items').insert(items).select('id, work_order_id, item_no');
    if (itemError) { await rollback(); throw new Error(itemError.message); }
    const itemId = new Map((insertedItems ?? []).map(r => [`${r.work_order_id}|${r.item_no}`, r.id as string]));
    const logs = fresh.flatMap(p => {
      const woId = idOf.get(p.work_order_number)!;
      const byNo = new Map(p.items.map(it => [it.no, it]));
      return p.logs.map(l => {
        const it = byNo.get(l.no)!;
        return {
          work_order_id: woId, work_order_item_id: itemId.get(`${woId}|${l.no}`), production_date: l.date,
          log_type: l.quantity >= it.quantity ? 'full' : 'partial', quantity_completed: l.quantity, area_m2: logArea(it, l.quantity),
          shift: l.shift, line_number: l.line, remark: MES_LOG_REMARK, created_by: userId,
        };
      });
    });
    for (let i = 0; i < logs.length; i += 1000) {
      const { error: logError } = await supabase.from('dgflow_production_logs').insert(logs.slice(i, i + 1000));
      if (logError) { await rollback(); throw new Error(logError.message); }
    }
    created = fresh.length;
    itemsCreated = items.length;
    logsInserted += logs.length;
    // 생산관리부 수신 확인 — 이미 생산이 끝난 의뢰서라 등록할 때 함께 확인으로 남긴다(2026-11-16 사용자 "생산관리부 확인으로 하고").
    // 표가 없으면 넘어간다
    const { error: rcError } = await supabase.from(RECEIPTS_TABLE)
      .upsert([...idOf.values()].map(id => ({ work_order_id: id, received_by: userId })), { onConflict: 'work_order_id', ignoreDuplicates: true });
    if (rcError && !isMissingTable(rcError)) throw new Error(rcError.message);
  }

  // ── 이미 있는 의뢰서
  const old = plans.filter(p => existing.has(p.work_order_number));
  let changedLogs = 0, keptRemoved = 0, existingLogs = 0, manualKept = 0, cappedQty = 0;
  if (old.length > 0) {
    type DbItem = { id: string; work_order_id: string; item_no: number | null; sort_order: number | null; quantity: number; produced_quantity: number | null; area_m2: number | string | null; width_mm: number; height_mm: number };
    type DbLog = { id: string; work_order_item_id: string; production_date: string; line_number: number | null; shift: string | null; quantity_completed: number; remark: string | null };
    const woIds = old.map(p => existing.get(p.work_order_number)!.id);
    const dbItems = await fetchAllIn<DbItem>(
      woIds, (chunk, a, b) => supabase.from('dgflow_work_order_items').select('id, work_order_id, item_no, sort_order, quantity, produced_quantity, area_m2, width_mm, height_mm')
        .in('work_order_id', chunk).order('id').range(a, b));
    const dbLogs = dbItems.length === 0 ? [] : await fetchAllIn<DbLog>(
      dbItems.map(i => i.id), (chunk, a, b) => supabase.from('dgflow_production_logs').select('id, work_order_item_id, production_date, line_number, shift, quantity_completed, remark')
        .in('work_order_item_id', chunk).order('id').range(a, b));
    const logOf = new Map<string, DbLog>();
    const producedBefore = new Map<string, number>();
    const logsOfItem = new Map<string, DbLog[]>();
    for (const l of dbLogs) {
      const k = logKey(l.work_order_item_id, l.production_date, l.line_number ?? 1, l.shift === 'night' ? 'night' : 'day');
      if (!logOf.has(k)) logOf.set(k, l);
      producedBefore.set(l.work_order_item_id, (producedBefore.get(l.work_order_item_id) ?? 0) + l.quantity_completed);
      const list = logsOfItem.get(l.work_order_item_id);
      if (list) list.push(l); else logsOfItem.set(l.work_order_item_id, [l]);
    }
    const isMes = (p: typeof old[number]) => (existing.get(p.work_order_number)!.notes ?? '').includes(MES_ORDER_NOTE);
    // 지난번에 올린 내용 — MES 로 만든 의뢰서만 견준다
    const seenOf = await fetchSeen(supabase, old.filter(isMes).map(p => p.work_order_number));
    const groupOf = new Map(groups.map(x => [`${x.wo}|${x.no}|${x.date}|${x.line}|${x.shift}`, x]));

    const touchedItems = new Set<string>();
    const touchedOrders = new Set<string>();
    for (const p of old) {
      const wo = existing.get(p.work_order_number)!;
      const mesMade = isMes(p);
      const mine = dbItems.filter(i => i.work_order_id === wo.id);
      const byNo = new Map(mine.map((i, k) => [itemNo(i, k), i]));
      // 사람이 등록한 의뢰서 — 손으로 넣은 생산이 있는 품목은 그대로 두고, 없는 품목만 의뢰 수량까지 MES 로 채운다 (planOtherOrderMes, P3)
      if (!mesMade) {
        const linesOf = new Map<number, MesOrderLog[]>();
        for (const l of p.logs) { const list = linesOf.get(l.no); if (list) list.push(l); else linesOf.set(l.no, [l]); }
        const rows = [];
        for (const [no, lines] of linesOf) {
          const it = byNo.get(no);
          if (!it) continue;
          const logs = logsOfItem.get(it.id) ?? [];
          const r = planOtherOrderMes({
            quantity: it.quantity,
            produced: it.produced_quantity ?? 0,
            mesQty: logs.filter(l => l.remark === MES_LOG_REMARK).reduce((s, l) => s + l.quantity_completed, 0),
            have: new Set(logs.map(l => otherKey({ date: l.production_date, line: l.line_number ?? 1, shift: l.shift === 'night' ? 'night' : 'day' }))),
          }, lines);
          if (r.manual) manualKept++;
          cappedQty += r.capped;
          for (const l of r.add) {
            rows.push({
              work_order_id: wo.id, work_order_item_id: it.id, production_date: l.date, log_type: 'partial',
              quantity_completed: l.quantity, area_m2: logArea({ ...it, area_m2: Number(it.area_m2) || 0 }, l.quantity),
              shift: l.shift, line_number: l.line, remark: MES_LOG_REMARK, created_by: userId,
            });
            touchedItems.add(it.id);
            touchedOrders.add(wo.id);
          }
        }
        if (rows.length > 0) {
          const { error: logError } = await supabase.from('dgflow_production_logs').insert(rows);
          if (logError) throw new Error(logError.message);
          logsInserted += rows.length;
          existingLogs += rows.length;
        }
        continue;
      }

      // MES 로 만든 의뢰서 — 지난번에 올린 내용과 견주어 달라진 것만
      const plan = planMesReupload(p, seenOf.get(p.work_order_number) ?? [], byNo.keys());
      keptRemoved += plan.removedNos.length;

      // 지난번에 없던 NO — 품목을 더한다
      const missing = p.items.filter(it => plan.newNos.includes(it.no));
      if (missing.length > 0) {
        const base = mine.length;
        const { data: added, error: addError } = await supabase.from('dgflow_work_order_items').insert(missing.map((it: MesOrderItem, k) => ({
          work_order_id: wo.id, product_name: it.product_name, width_mm: it.width_mm, height_mm: it.height_mm, quantity: it.quantity,
          area_m2: it.area_m2, produced_quantity: 0, remark: it.remark, sort_order: base + k, item_no: it.no,
        }))).select('id, work_order_id, item_no, sort_order, quantity, area_m2, width_mm, height_mm');
        if (addError) throw new Error(addError.message);
        for (const a of added ?? []) { byNo.set(a.item_no as number, a as DbItem); dbItems.push(a as DbItem); }
        itemsCreated += added?.length ?? 0;
      }

      // 새 생산 — 같은 날 · 호기 · 주야간 기록이 이미 있으면 건너뛴다(중간에 끊겨 다시 보낸 경우 · 손으로 먼저 넣은 경우)
      const rows = [];
      for (const l of plan.fresh) {
        const it = byNo.get(l.no);
        if (!it) continue;
        const k = logKey(it.id, l.date, l.line, l.shift);
        if (logOf.has(k)) continue;
        logOf.set(k, { id: '', work_order_item_id: it.id, production_date: l.date, line_number: l.line, shift: l.shift, quantity_completed: l.quantity, remark: MES_LOG_REMARK });
        rows.push({
          work_order_id: wo.id, work_order_item_id: it.id, production_date: l.date, log_type: 'partial',
          quantity_completed: l.quantity, area_m2: logArea({ ...it, area_m2: Number(it.area_m2) || 0 }, l.quantity),
          shift: l.shift, line_number: l.line, remark: MES_LOG_REMARK, created_by: userId,
        });
        touchedItems.add(it.id);
        touchedOrders.add(wo.id);
      }
      if (rows.length > 0) {
        const { error: logError } = await supabase.from('dgflow_production_logs').insert(rows);
        if (logError) throw new Error(logError.message);
        logsInserted += rows.length;
        existingLogs += rows.length;
      }

      // 지난번과 장수가 달라진 줄 — 달라진 만큼만. 그 기록을 사람이 지웠으면 늘어난 만큼만 새로 넣고, 줄어든 것은 넘어간다
      for (const c of plan.changed) {
        const it = byNo.get(c.no);
        if (!it) continue;
        const sized = { ...it, area_m2: Number(it.area_m2) || 0 };
        const cur = logOf.get(logKey(it.id, c.date, c.line, c.shift));
        if (cur?.id) {
          const q = cur.quantity_completed + c.delta;
          const { error: e } = q <= 0
            ? await supabase.from('dgflow_production_logs').delete().eq('id', cur.id)
            : await supabase.from('dgflow_production_logs').update({ quantity_completed: q, area_m2: logArea(sized, q) }).eq('id', cur.id);
          if (e) throw new Error(e.message);
        } else if (c.delta > 0 && !cur) {
          const { error: e } = await supabase.from('dgflow_production_logs').insert({
            work_order_id: wo.id, work_order_item_id: it.id, production_date: c.date, log_type: 'partial',
            quantity_completed: c.delta, area_m2: logArea(sized, c.delta), shift: c.shift, line_number: c.line, remark: MES_LOG_REMARK, created_by: userId,
          });
          if (e) throw new Error(e.message);
        } else continue;
        changedLogs++;
        touchedItems.add(it.id);
        touchedOrders.add(wo.id);
      }
      // 달라진 줄은 바로 표에 적는다 — 이 요청이 뒤에서 끊겨 다시 보내도 같은 차이를 두 번 넣지 않게
      if (plan.changed.length > 0) {
        await saveSeen(supabase, plan.changed.flatMap(c => groupOf.get(`${p.work_order_number}|${c.no}|${c.date}|${c.line}|${c.shift}`) ?? []), userId, file);
      }
    }
    // 완료 수량 = 기록의 합. MES 로 만든 의뢰서는 의뢰 수량도 MES 기준이라 — 생산이 의뢰 수량을 넘으면 늘리고,
    // 의뢰 수량과 생산이 같던 품목의 생산이 줄었으면(MES 장수가 줄어 온 경우) 같이 줄인다
    const mesOrderIds = new Set(old.filter(isMes).map(p => existing.get(p.work_order_number)!.id));
    const itemById = new Map(dbItems.map(i => [i.id, i]));
    for (const id of touchedItems) {
      const produced = await syncProducedQuantity(supabase, id);
      const it = itemById.get(id);
      if (!it || !mesOrderIds.has(it.work_order_id)) continue;
      const before = producedBefore.get(id) ?? 0;
      if (produced > it.quantity || (produced >= 1 && produced < before && it.quantity === before)) {
        await supabase.from('dgflow_work_order_items').update({ quantity: produced, area_m2: expectedArea(it.width_mm, it.height_mm, produced) }).eq('id', id);
      }
    }
    for (const id of touchedOrders) if (!mesOrderIds.has(id)) await syncWorkOrderStatus(supabase, id);
  }
  return { created, existing: old.length, items: itemsCreated, logs: logsInserted, existingLogs, changed: changedLogs, keptRemoved, manualKept, cappedQty };
}

/** 의뢰번호별 "지난번에 올린 내용" — MES 실적 표의 줄. 표가 없으면 빈 것으로 */
async function fetchSeen(supabase: Db, numbers: string[]): Promise<Map<string, MesSeenRow[]>> {
  const out = new Map<string, MesSeenRow[]>();
  if (numbers.length === 0) return out;
  type Row = { work_order_number: string; item_no: number; production_date: string; line_number: number; shift: string; quantity: number };
  let rows: Row[] = [];
  try {
    rows = await fetchAllIn<Row>(numbers, (chunk, a, b) => supabase.from(MES_TABLE)
      .select('work_order_number, item_no, production_date, line_number, shift, quantity').in('work_order_number', chunk)
      .order('production_date').order('line_number').order('shift').order('work_order_number').order('item_no').range(a, b));
  } catch (e) {
    if (!isMissingTable({ message: e instanceof Error ? e.message : String(e) })) throw e;
  }
  for (const r of rows) {
    const list = out.get(r.work_order_number) ?? [];
    list.push({ no: r.item_no, date: r.production_date, line: r.line_number, shift: r.shift === 'night' ? 'night' : 'day', quantity: r.quantity });
    out.set(r.work_order_number, list);
  }
  return out;
}
