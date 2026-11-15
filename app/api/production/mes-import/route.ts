import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isIsoDate } from '@/lib/production/daily-report';
import { proRataArea, syncProducedQuantity } from '@/lib/production/produced-quantity';
import { syncWorkOrderStatus } from '@/lib/work-order/stage';
import { loadMesOrders } from '@/lib/production/mes-store';
import {
  MES_COMMIT_ENABLED, MES_REMARK, isInsert, normalizeWorkOrderNumber, planMesImport, type MesDbOrder, type MesGroup,
} from '@/lib/production/mes';

/** 한 번에 받는 양 — 화면이 의뢰번호 단위로 나눠 보낸다 */
const MAX_NUMBERS = 3000;
const MAX_GROUPS = 1500;

/**
 * MES 생산실적 가져오기 (lib/production/mes.ts).
 *
 *   POST { mode: 'check', numbers }   → { orders } 의뢰번호별 시스템 의뢰서 · 품목 · 이미 들어간 생산 기록 (아무것도 쓰지 않는다)
 *   POST { mode: 'commit', groups }   → 서버가 계획을 다시 계산해 넣을 것만 생산 기록으로 넣는다
 *
 * 수신 확인은 따지지 않는다 — MES 에 포장 바코드가 찍혔다는 것이 이미 오창공장에서 만들었다는 기록이라서.
 * 주간/야간은 아직 정하지 않아 모두 주간(day)으로 넣는다 (2026-11-13 사용자).
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:input')) {
    return NextResponse.json({ error: '생산 실적을 입력할 권한이 없습니다.' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();

  if (body?.mode === 'check') {
    const numbers = Array.isArray(body.numbers)
      ? [...new Set((body.numbers as unknown[]).map(normalizeWorkOrderNumber).filter((n): n is string => !!n))]
      : [];
    if (numbers.length > MAX_NUMBERS) {
      return NextResponse.json({ error: `한 번에 의뢰번호 ${MAX_NUMBERS}건까지 확인할 수 있습니다. 기간을 줄여 주세요.` }, { status: 400 });
    }
    try {
      return NextResponse.json({ orders: await loadMesOrders(supabase, numbers) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : '작업의뢰서를 읽지 못했습니다.' }, { status: 500 });
    }
  }

  if (body?.mode !== 'commit') return NextResponse.json({ error: '요청을 알아보지 못했습니다.' }, { status: 400 });
  if (!MES_COMMIT_ENABLED) {
    return NextResponse.json({ error: '시험 단계라 아직 생산 실적으로 등록하지 않습니다. 미리보기만 할 수 있습니다.' }, { status: 403 });
  }

  const raw = Array.isArray(body.groups) ? (body.groups as Partial<MesGroup>[]) : [];
  if (raw.length === 0 || raw.length > MAX_GROUPS) {
    return NextResponse.json({ error: `한 번에 ${MAX_GROUPS}줄까지 보낼 수 있습니다.` }, { status: 400 });
  }
  // 다시 한 번 확인 — 화면을 믿지 않는다
  const groups: MesGroup[] = [];
  for (const g of raw) {
    const wo = normalizeWorkOrderNumber(g?.wo);
    const ok = wo && Number.isInteger(g.no) && g.no! > 0 && typeof g.date === 'string' && isIsoDate(g.date)
      && (g.line === 1 || g.line === 2) && (g.shift === 'day' || g.shift === 'night') && Number.isInteger(g.count) && g.count! > 0 && g.count! <= 100_000
      && (g.width === undefined || Number.isFinite(g.width)) && (g.height === undefined || Number.isFinite(g.height));
    if (!ok) return NextResponse.json({ error: '보낸 실적 중 형식이 맞지 않는 줄이 있습니다.' }, { status: 400 });
    groups.push({
      wo: wo!, no: g.no!, date: g.date!, line: g.line!, shift: g.shift!, count: g.count!,
      width: Number(g.width) || 0, height: Number(g.height) || 0,
      product: '', customer: '', site: '', remark: '',
    });
  }

  let orders: MesDbOrder[];
  try {
    orders = await loadMesOrders(supabase, groups.map(g => g.wo));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '작업의뢰서를 읽지 못했습니다.' }, { status: 500 });
  }
  const plan = planMesImport(groups, new Map(orders.map(o => [o.work_order_number, o])));
  const items = new Map(orders.flatMap(o => o.items.map(it => [it.id, it] as const)));
  const rows = plan.filter(isInsert).map(r => {
    const it = items.get(r.itemId!)!;
    return {
      work_order_id: r.workOrderId!,
      work_order_item_id: r.itemId!,
      production_date: r.date,
      log_type: r.add >= it.quantity ? 'full' : 'partial',
      quantity_completed: r.add,
      area_m2: proRataArea(it, r.add),
      // 바코드 시각으로 가른 주간 · 야간 (2026-11-13 회의 — 야간 18:00–21:00)
      shift: r.shift,
      line_number: r.line,
      remark: MES_REMARK,
      created_by: user.id,
    };
  });

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('dgflow_production_logs').insert(rows.slice(i, i + 500));
    if (error) {
      return NextResponse.json({ error: `${error.message} — 그때까지 ${i}건은 들어갔습니다. 다시 올리면 들어간 것은 건너뜁니다.` }, { status: 500 });
    }
  }

  // 품목 완료 수량 = 기록의 합, 의뢰서 상태도 다시 맞춘다
  const itemIds = [...new Set(rows.map(r => r.work_order_item_id))];
  const orderIds = [...new Set(rows.map(r => r.work_order_id))];
  await inBatches(itemIds, id => syncProducedQuantity(supabase, id));
  await inBatches(orderIds, id => syncWorkOrderStatus(supabase, id));

  return NextResponse.json({
    inserted: rows.length,
    quantity: rows.reduce((s, r) => s + r.quantity_completed, 0),
    items: itemIds.length,
    orders: orderIds.length,
  });
}

/** 한꺼번에 수백 번 부르지 않게 8개씩 */
async function inBatches<T>(list: T[], fn: (v: T) => Promise<unknown>) {
  for (let i = 0; i < list.length; i += 8) await Promise.all(list.slice(i, i + 8).map(fn));
}
