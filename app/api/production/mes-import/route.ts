import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isIsoDate } from '@/lib/production/daily-report';
import { isMissingTable } from '@/lib/production/bokcheung-store';
import { fetchMesDailyTotals, toMesRow } from '@/lib/production/mes-db';
import { MES_COMMIT_ENABLED, MES_TABLE, normalizeWorkOrderNumber, type MesGroup } from '@/lib/production/mes';
import { MES_ORDER_NOTE, logArea, planMesOrders, type MesOrderItem } from '@/lib/production/mes-orders';
import { itemNo } from '@/lib/production/item-view';
import { syncProducedQuantity } from '@/lib/production/produced-quantity';
import { syncWorkOrderStatus } from '@/lib/work-order/stage';
import { expectedArea } from '@/lib/work-order/verify';
import { fetchAllIn } from '@/lib/supabase/fetch-all';

/** 한 번에 받는 줄 — 화면이 나눠 보낸다 */
const MAX_GROUPS = 2000;
/** 작업의뢰서 만들기는 의뢰번호 단위로 — 한 번에 의뢰서 이만큼 · 줄 이만큼 */
const MAX_ORDER_NUMBERS = 80;
const MAX_ORDER_GROUPS = 8000;

/**
 * MES 생산실적 → MES 실적 표 (lib/production/mes.ts · mes-db.ts, 2026-11-15 작업의뢰서 없이 넣는 방식).
 *
 *   GET                                   → 지금 표에 들어 있는 MES 실적 (기간 · 장수 · 마지막 등록)
 *   POST { mode: 'commit', file, groups } → 날짜 · 호기 · 주야간 · 의뢰번호 · NO 열쇠로 덮어쓴다(같은 파일을 다시 올려도 두 번 세지 않는다)
 *   POST { mode: 'clear', from, to }      → 그 기간 MES 실적을 지운다(다시 올리기 전에)
 *   POST { mode: 'orders', groups }       → 지난 작업의뢰서 + 생산 기록으로 만든다(lib/production/mes-orders.ts) — 의뢰번호 단위로 나눠 보낸다.
 *        없는 의뢰번호는 새 작업의뢰서(상태 완료), 있는 의뢰번호는 같은 NO 품목에 빠진 생산 기록만 붙인다(다시 보내도 두 번 안 붙는다)
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
    try {
      return NextResponse.json(await createOrders(supabase, groups, g.user.id));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : '작업의뢰서를 만들지 못했습니다.' }, { status: 500 });
    }
  }

  if (body?.mode !== 'commit') return NextResponse.json({ error: '요청을 알아보지 못했습니다.' }, { status: 400 });
  if (!MES_COMMIT_ENABLED) {
    return NextResponse.json({ error: '시험 단계라 아직 등록하지 않습니다. 미리보기만 할 수 있습니다.' }, { status: 403 });
  }
  const groups = parseGroups(body.groups, MAX_GROUPS);
  if (typeof groups === 'string') return NextResponse.json({ error: groups }, { status: 400 });
  const file = String(body.file ?? '').trim().slice(0, 200) || null;
  const rows = groups.map(x => ({ ...toMesRow(x), source_file: file, imported_by: g.user.id, imported_at: new Date().toISOString() }));
  const { error } = await supabase.from(MES_TABLE)
    .upsert(rows, { onConflict: 'production_date,line_number,shift,work_order_number,item_no' });
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: 'MES 실적 표가 아직 없습니다. 관리자에게 알려 주세요.' }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: rows.length, quantity: rows.reduce((s, r) => s + r.quantity, 0) });
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
 * 없는 의뢰번호 → 새 작업의뢰서(완료) · 품목 · 생산 기록. 있는 의뢰번호 → 같은 NO 품목에 그 날 · 호기 · 주야간 기록이 없을 때만 붙인다.
 * MES 로 만든 의뢰서에 새 NO 가 오면 품목을 더하고, 생산이 의뢰 수량을 넘으면 수량을 늘린다.
 */
async function createOrders(supabase: Db, groups: MesGroup[], userId: string) {
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
          shift: l.shift, line_number: l.line, remark: 'MES 바코드', created_by: userId,
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
  }

  // ── 이미 있는 의뢰서 — 빠진 기록만 붙인다
  const old = plans.filter(p => existing.has(p.work_order_number));
  if (old.length > 0) {
    const woIds = old.map(p => existing.get(p.work_order_number)!.id);
    const dbItems = await fetchAllIn<{ id: string; work_order_id: string; item_no: number | null; sort_order: number | null; quantity: number; area_m2: number | string | null; width_mm: number; height_mm: number }>(
      woIds, (chunk, a, b) => supabase.from('dgflow_work_order_items').select('id, work_order_id, item_no, sort_order, quantity, area_m2, width_mm, height_mm')
        .in('work_order_id', chunk).order('id').range(a, b));
    const dbLogs = dbItems.length === 0 ? [] : await fetchAllIn<{ work_order_item_id: string; production_date: string; line_number: number | null; shift: string | null }>(
      dbItems.map(i => i.id), (chunk, a, b) => supabase.from('dgflow_production_logs').select('work_order_item_id, production_date, line_number, shift')
        .in('work_order_item_id', chunk).order('id').range(a, b));
    const have = new Set(dbLogs.map(l => logKey(l.work_order_item_id, l.production_date, l.line_number ?? 1, l.shift === 'night' ? 'night' : 'day')));
    const touchedItems = new Set<string>();
    const touchedOrders = new Set<string>();
    for (const p of old) {
      const wo = existing.get(p.work_order_number)!;
      const mesMade = (wo.notes ?? '').includes(MES_ORDER_NOTE);
      const mine = dbItems.filter(i => i.work_order_id === wo.id);
      const byNo = new Map(mine.map((i, k) => [itemNo(i, k), i]));
      // MES 로 만든 의뢰서에 새 NO 가 오면 품목을 더한다
      const missing = mesMade ? p.items.filter(it => !byNo.has(it.no)) : [];
      if (missing.length > 0) {
        const base = mine.length;
        const { data: added, error: addError } = await supabase.from('dgflow_work_order_items').insert(missing.map((it: MesOrderItem, k) => ({
          work_order_id: wo.id, product_name: it.product_name, width_mm: it.width_mm, height_mm: it.height_mm, quantity: it.quantity,
          area_m2: it.area_m2, produced_quantity: 0, remark: it.remark, sort_order: base + k, item_no: it.no,
        }))).select('id, work_order_id, item_no, sort_order, quantity, area_m2, width_mm, height_mm');
        if (addError) throw new Error(addError.message);
        for (const a of added ?? []) byNo.set(a.item_no as number, a as typeof mine[number]);
        itemsCreated += added?.length ?? 0;
      }
      const rows = [];
      for (const l of p.logs) {
        const it = byNo.get(l.no);
        if (!it || have.has(logKey(it.id, l.date, l.line, l.shift))) continue;
        have.add(logKey(it.id, l.date, l.line, l.shift));
        rows.push({
          work_order_id: wo.id, work_order_item_id: it.id, production_date: l.date, log_type: 'partial',
          quantity_completed: l.quantity, area_m2: logArea({ ...it, area_m2: Number(it.area_m2) || 0 }, l.quantity),
          shift: l.shift, line_number: l.line, remark: 'MES 바코드', created_by: userId,
        });
        touchedItems.add(it.id);
        touchedOrders.add(wo.id);
      }
      if (rows.length > 0) {
        const { error: logError } = await supabase.from('dgflow_production_logs').insert(rows);
        if (logError) throw new Error(logError.message);
        logsInserted += rows.length;
      }
    }
    // 완료 수량 = 기록의 합. MES 로 만든 의뢰서는 생산이 의뢰 수량을 넘으면 수량을 늘린다(의뢰 수량도 MES 기준이라서)
    const mesOrderIds = new Set(old.filter(p => (existing.get(p.work_order_number)!.notes ?? '').includes(MES_ORDER_NOTE)).map(p => existing.get(p.work_order_number)!.id));
    const itemById = new Map(dbItems.map(i => [i.id, i]));
    for (const id of touchedItems) {
      const produced = await syncProducedQuantity(supabase, id);
      const it = itemById.get(id);
      if (it && mesOrderIds.has(it.work_order_id) && produced > it.quantity) {
        await supabase.from('dgflow_work_order_items').update({ quantity: produced, area_m2: expectedArea(it.width_mm, it.height_mm, produced) }).eq('id', id);
      }
    }
    for (const id of touchedOrders) if (!mesOrderIds.has(id)) await syncWorkOrderStatus(supabase, id);
  }
  return { created, existing: old.length, items: itemsCreated, logs: logsInserted };
}
