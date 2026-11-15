import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { importPlan, type ErpListOrder, type ImportOptions } from '@/lib/work-order/erp-list';
import { DELIVERY_TABLE } from '@/lib/production/delivery';
import { isMissingTable } from '@/lib/production/bokcheung-store';
import { proRataArea } from '@/lib/production/produced-quantity';

/** 한 번에 받는 양 — 화면이 나눠 보낸다 */
const MAX_ORDERS = 60;
const MAX_ITEMS = 3000;

/**
 * 지난 작업의뢰서 한꺼번에 가져오기 (ERP 작업의뢰서 목록 엑셀, lib/work-order/erp-list.ts).
 *
 *   POST { mode: 'check', numbers }            → { existing } 이미 등록된 의뢰번호
 *   POST { mode: 'commit', orders, options }   → { created, skipped } 새 의뢰서만 넣는다
 *     options: 출고 수량 → 생산(producedFromShipped) · 납품 기록(deliveredFromShipped), 잔여 의뢰서 기본 처리(remainingStatus) ·
 *              의뢰서마다 따로 고른 처리(statusByOrder) — 2026-11-13 회의
 *
 * 의뢰서 한 장씩 등록하는 길(/api/work-orders/from-scan)과 같은 칸에 넣는다 — 주문(dgflow_orders) 없이,
 * 의뢰번호는 ERP 번호 그대로. 이미 있는 의뢰번호는 건너뛴다(덮어쓰지 않는다).
 * 생산 수량 · 상태는 화면에서 고른 규칙(importPlan)대로. 메모에 ERP 주문번호와 가져온 날을 남긴다.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'work_order:create')) {
    return NextResponse.json({ error: '작업의뢰서 등록 권한이 없습니다.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();

  if (body?.mode === 'check') {
    const numbers = Array.isArray(body.numbers) ? body.numbers.map(String).slice(0, 5000) : [];
    const existing: string[] = [];
    for (let i = 0; i < numbers.length; i += 300) {
      const { data, error } = await supabase
        .from('dgflow_work_orders').select('work_order_number').in('work_order_number', numbers.slice(i, i + 300));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      existing.push(...(data ?? []).map(r => r.work_order_number as string));
    }
    return NextResponse.json({ existing });
  }

  if (body?.mode !== 'commit') return NextResponse.json({ error: '요청을 알아보지 못했습니다.' }, { status: 400 });

  const raw = body.options as ImportOptions | undefined;
  if (!raw || typeof raw.producedFromShipped !== 'boolean' || !['active', 'archive'].includes(raw.remainingStatus)) {
    return NextResponse.json({ error: '가져오기 방식(출고 수량 · 잔여 의뢰서)을 선택하세요.' }, { status: 400 });
  }
  // 의뢰서마다 고른 상태 — 알아볼 수 있는 값만 받는다
  const statusByOrder: Record<string, 'active' | 'archive'> = {};
  if (raw.statusByOrder && typeof raw.statusByOrder === 'object') {
    for (const [k, v] of Object.entries(raw.statusByOrder)) {
      if ((v === 'active' || v === 'archive') && k.length <= 40) statusByOrder[k] = v;
    }
  }
  const options: ImportOptions = {
    producedFromShipped: raw.producedFromShipped,
    // 납품은 생산으로 넣은 수량만큼만 — 생산 없이 납품만 넣지 않는다
    deliveredFromShipped: raw.producedFromShipped && raw.deliveredFromShipped === true,
    remainingStatus: raw.remainingStatus,
    statusByOrder,
  };
  const orders = Array.isArray(body.orders) ? (body.orders as ErpListOrder[]) : [];
  const itemTotal = orders.reduce((s, o) => s + (Array.isArray(o?.items) ? o.items.length : 0), 0);
  if (orders.length === 0 || orders.length > MAX_ORDERS || itemTotal > MAX_ITEMS) {
    return NextResponse.json({ error: `한 번에 의뢰서 ${MAX_ORDERS}건 · 품목 ${MAX_ITEMS}줄까지 보낼 수 있습니다.` }, { status: 400 });
  }

  // 다시 한 번 확인 — 화면을 믿지 않는다
  for (const o of orders) {
    const ok = typeof o?.work_order_number === 'string' && o.work_order_number.trim() && o.work_order_number.length <= 40
      && Array.isArray(o.items) && o.items.length > 0
      && o.items.every(it => typeof it?.product_name === 'string' && it.product_name.trim() && it.product_name.length <= 200
        && Number.isInteger(it.width_mm) && it.width_mm > 0 && Number.isInteger(it.height_mm) && it.height_mm > 0
        && Number.isInteger(it.quantity) && it.quantity > 0 && Number.isFinite(it.area_m2));
    if (!ok) return NextResponse.json({ error: `의뢰서 ${String(o?.work_order_number ?? '?')} 의 내용이 올바르지 않습니다.` }, { status: 400 });
  }

  // 이미 있는 의뢰번호는 건너뛴다
  const numbers = orders.map(o => o.work_order_number.trim());
  const { data: dup, error: dupError } = await supabase
    .from('dgflow_work_orders').select('work_order_number').in('work_order_number', numbers);
  if (dupError) return NextResponse.json({ error: dupError.message }, { status: 500 });
  const existing = new Set((dup ?? []).map(r => r.work_order_number as string));
  const fresh = orders.filter(o => !existing.has(o.work_order_number.trim()));
  if (fresh.length === 0) return NextResponse.json({ created: 0, skipped: [...existing] });

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const plans = fresh.map(o => importPlan(o, options));
  const { data: inserted, error: woError } = await supabase
    .from('dgflow_work_orders')
    .insert(fresh.map((o, k) => ({
      order_id: null,
      work_order_number: o.work_order_number.trim(),
      request_date: o.request_date || today,
      delivery_date: o.delivery_date || null,
      customer_label: o.customer?.trim() || null,
      site_label: o.site?.trim() || null,
      notes: [o.erp_order_number ? `ERP 주문번호 ${o.erp_order_number}` : '', `지난 작업의뢰서 가져오기 ${today}`].filter(Boolean).join(' · '),
      status: plans[k].status,
    })))
    .select('id, work_order_number');
  if (woError) return NextResponse.json({ error: woError.message }, { status: 500 });

  const idOf = new Map((inserted ?? []).map(r => [r.work_order_number as string, r.id as string]));
  const items = fresh.flatMap((o, k) => o.items.map((it, idx) => ({
    work_order_id: idOf.get(o.work_order_number.trim()),
    product_name: it.product_name.trim(),
    width_mm: it.width_mm,
    height_mm: it.height_mm,
    quantity: it.quantity,
    area_m2: it.area_m2,
    produced_quantity: plans[k].produced[idx],
    remark: it.remark?.trim() || null,
    sort_order: idx,
    // ERP 목록의 NO 그대로 (없으면 순서)
    item_no: it.no > 0 ? it.no : idx + 1,
  })));
  const { data: insertedItems, error: itemError } = await supabase
    .from('dgflow_work_order_items').insert(items).select('id, work_order_id, sort_order');
  // 품목 · 납품이 실패하면 이번에 만든 의뢰서를 지운다(품목 · 납품 기록은 따라 지워진다) — 반쪽짜리를 남기지 않는다
  const rollback = () => supabase.from('dgflow_work_orders').delete().in('id', [...idOf.values()]);
  if (itemError) {
    await rollback();
    return NextResponse.json({ error: itemError.message }, { status: 500 });
  }

  // 출고 수량을 납품 기록으로도 — 납품일은 ERP 납품일자(없으면 주문일). 실제로 현장에 들어간 날과 다를 수 있어 메모로 남긴다
  let deliveries = 0;
  if (options.deliveredFromShipped) {
    const itemId = new Map((insertedItems ?? []).map(r => [`${r.work_order_id}|${r.sort_order}`, r.id as string]));
    const rows = fresh.flatMap((o, k) => {
      const woId = idOf.get(o.work_order_number.trim());
      const date = o.delivery_date || o.request_date || today;
      return o.items.flatMap((it, idx) => {
        const qty = plans[k].delivered[idx];
        const id = itemId.get(`${woId}|${idx}`);
        if (!qty || !woId || !id) return [];
        return [{
          work_order_id: woId,
          work_order_item_id: id,
          delivery_date: date,
          quantity: qty,
          area_m2: proRataArea(it, qty),
          note: `지난 작업의뢰서 가져오기 — ERP 출고수량 (납품일은 ERP 납품일자)`,
          created_by: user.id,
        }];
      });
    });
    if (rows.length > 0) {
      const { error: deliveryError } = await supabase.from(DELIVERY_TABLE).insert(rows);
      if (deliveryError) {
        await rollback();
        const message = isMissingTable(deliveryError) ? '납품 기록을 저장할 표가 아직 없습니다. 납품 기록 없이 가져오세요.' : deliveryError.message;
        return NextResponse.json({ error: message }, { status: 500 });
      }
      deliveries = rows.length;
    }
  }

  return NextResponse.json({ created: fresh.length, items: items.length, deliveries, skipped: [...existing] }, { status: 201 });
}
