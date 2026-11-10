import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { isIsoDate } from '@/lib/production/daily-report';
import { DELIVERY_TABLE } from '@/lib/production/delivery';
import { loadDeliveries } from '@/lib/production/delivery-store';
import { isMissingTable } from '@/lib/production/bokcheung-store';
import { syncWorkOrderStatus } from '@/lib/work-order/stage';
import { proRataArea } from '@/lib/production/produced-quantity';

/**
 * 납품 기록 (2026-11-06 회의).
 *   GET  ?work_order_id=                                        그 의뢰서의 납품 기록
 *   POST { work_order_id, delivery_date, note, items: [{ work_order_item_id, quantity }] }  납품 입력
 * 생산 수량을 넘어도 막지 않는다 — 재고가 함께 나갈 수 있다 (화면이 알리기만 한다).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:view')) {
    return NextResponse.json({ error: '생산 현황을 볼 권한이 없습니다.' }, { status: 403 });
  }
  const id = request.nextUrl.searchParams.get('work_order_id');
  if (!id) return NextResponse.json({ error: '작업의뢰서를 지정하세요.' }, { status: 400 });
  try {
    return NextResponse.json(await loadDeliveries(createServiceRoleClient(), [id]));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '납품 기록을 읽지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:input')) {
    return NextResponse.json({ error: '납품 수량을 입력할 권한이 없습니다.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as {
    work_order_id?: string; delivery_date?: string; note?: string;
    items?: { work_order_item_id?: string; quantity?: number }[];
  } | null;
  const entries = (body?.items ?? []).filter(i => Number.isInteger(i.quantity) && i.quantity! > 0);
  if (!body?.work_order_id || !isIsoDate(body.delivery_date ?? null) || entries.length === 0) {
    return NextResponse.json({ error: '납품일과 수량을 입력하세요.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  type ItemRow = { id: string; width_mm: number; height_mm: number; quantity: number; area_m2: number | null };
  let items: ItemRow[];
  try {
    // 1,000줄에서 잘리지 않게 끝까지 읽는다 (2026-11-10 점검)
    items = await fetchAll<ItemRow>((from, to) => supabase
      .from('dgflow_work_order_items').select('id, width_mm, height_mm, quantity, area_m2')
      .eq('work_order_id', body.work_order_id!).order('id').range(from, to));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '품목을 읽지 못했습니다.' }, { status: 500 });
  }
  const byId = new Map(items.map(i => [i.id, i]));

  const rows = [];
  for (const e of entries) {
    const item = byId.get(String(e.work_order_item_id));
    if (!item) return NextResponse.json({ error: '이 작업의뢰서의 품목이 아닙니다.' }, { status: 400 });
    rows.push({
      work_order_id: body.work_order_id,
      work_order_item_id: item.id,
      delivery_date: body.delivery_date,
      quantity: e.quantity,
      // 작업의뢰서 면적(ERP 규칙)을 수량 비율로 — 가로×세로×수량을 한 번에 반올림하면 의뢰서와 어긋났다 (2026-11-10 점검)
      area_m2: proRataArea(item, e.quantity!),
      note: body.note?.trim().slice(0, 200) || null,
      created_by: user.id,
    });
  }

  const { error } = await supabase.from(DELIVERY_TABLE).insert(rows);
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ error: '납품 기록을 저장할 표가 아직 없습니다.', code: 'NO_TABLE' }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await syncWorkOrderStatus(supabase, body.work_order_id);
  return NextResponse.json({ saved: rows.length }, { status: 201 });
}
