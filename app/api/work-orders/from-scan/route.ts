import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { format } from 'date-fns';

/**
 * 사원이 화면에서 확인한 작업의뢰서를 저장한다.
 *
 * 주문(dgflow_orders)을 만들지 않는다. 이 작업의뢰서는 ERP 가 만든 것이고
 * 우리 쪽 주문과 1:1 로 이어진다는 보장이 없다. order_id 를 비워 두는 건
 * 마이그레이션 015 에서 열어 둔 길이다.
 *
 * 의뢰번호도 우리가 채번하지 않는다 — 문서에 찍힌 ERP 번호를 그대로 쓴다.
 * 현장에서 종이와 화면을 대조할 때 같은 번호여야 한다.
 */

interface Payload {
  work_order_number: string | null;
  customer_label: string | null;
  site_label: string | null;
  request_date: string | null;
  delivery_date: string | null;
  notes: string | null;
  items: {
    product_name: string;
    width_mm: number;
    height_mm: number;
    quantity: number;
    area_m2: number | null;
    remark: string | null;
  }[];
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'work_order:create')) {
    return NextResponse.json({ error: '작업의뢰서 생성 권한이 없습니다.' }, { status: 403 });
  }

  const payload = (await request.json()) as Payload;

  if (!payload.work_order_number?.trim()) {
    return NextResponse.json({ error: '의뢰번호를 입력하세요.' }, { status: 400 });
  }
  if (!payload.items?.length) {
    return NextResponse.json({ error: '품목이 비어 있습니다.' }, { status: 400 });
  }

  const bad = payload.items.find(
    (i) => !i.product_name?.trim() || !i.width_mm || !i.height_mm || !i.quantity
  );
  if (bad) {
    return NextResponse.json(
      { error: '품명 · 규격 · 수량이 비어 있는 행이 있습니다.' },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();
  const workOrderNumber = payload.work_order_number.trim();

  // 같은 의뢰서를 두 번 올리는 일이 잦다. 번호로 막는다.
  const { data: dup } = await supabase
    .from('dgflow_work_orders')
    .select('id')
    .eq('work_order_number', workOrderNumber)
    .maybeSingle();

  if (dup) {
    return NextResponse.json(
      { error: `의뢰번호 ${workOrderNumber} 는 이미 등록돼 있습니다.`, id: dup.id },
      { status: 409 }
    );
  }

  const { data: workOrder, error: woError } = await supabase
    .from('dgflow_work_orders')
    .insert({
      order_id: null,
      work_order_number: workOrderNumber,
      request_date: payload.request_date || format(new Date(), 'yyyy-MM-dd'),
      delivery_date: payload.delivery_date || null,
      customer_label: payload.customer_label?.trim() || null,
      site_label: payload.site_label?.trim() || null,
      notes: payload.notes?.trim() || null,
      status: 'pending',
    })
    .select()
    .single();

  if (woError) return NextResponse.json({ error: woError.message }, { status: 500 });

  const { error: itemError } = await supabase.from('dgflow_work_order_items').insert(
    payload.items.map((item, idx) => ({
      work_order_id: workOrder.id,
      product_name: item.product_name.trim(),
      width_mm: item.width_mm,
      height_mm: item.height_mm,
      quantity: item.quantity,
      area_m2: item.area_m2,
      remark: item.remark?.trim() || null,
      sort_order: idx,
    }))
  );

  if (itemError) {
    await supabase.from('dgflow_work_orders').delete().eq('id', workOrder.id);
    return NextResponse.json({ error: itemError.message }, { status: 500 });
  }

  return NextResponse.json({ data: workOrder }, { status: 201 });
}
