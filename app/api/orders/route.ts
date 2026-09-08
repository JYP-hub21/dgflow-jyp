import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/orders - 주문 목록 조회
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get('status');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('dgflow_orders')
    .select(`
      *,
      customer:dgflow_customers(name, short_name),
      site:dgflow_sites(site_name),
      creator:dgflow_users!created_by(name)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data, count, page, limit });
}

// POST /api/orders - 주문 생성
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { customer_id, site_id, order_date, delivery_date, remark, items } = body;

  if (!customer_id || !site_id || !items?.length) {
    return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // 주문 생성
  const totalQuantity = items.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0);
  const totalArea = items.reduce((sum: number, item: { width_mm: number; height_mm: number; quantity: number }) =>
    sum + (item.width_mm * item.height_mm * item.quantity / 1_000_000), 0);

  const { data: order, error: orderError } = await supabase
    .from('dgflow_orders')
    .insert({
      customer_id,
      site_id,
      created_by: user.id,
      order_date: order_date || new Date().toISOString().split('T')[0],
      delivery_date,
      status: 'draft',
      total_quantity: totalQuantity,
      total_area_m2: Math.round(totalArea * 100) / 100,
      remark,
    })
    .select()
    .single();

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }

  // 품목 생성
  const orderItems = items.map((item: {
    product_id?: string;
    product_name: string;
    width_mm: number;
    height_mm: number;
    quantity: number;
    location_dong?: string;
    location_line?: string;
    location_floor?: string;
    location_room?: string;
    location_type?: string;
    location_window_type?: string;
    remark?: string;
  }, index: number) => ({
    order_id: order.id,
    product_id: item.product_id || null,
    product_name: item.product_name,
    width_mm: item.width_mm,
    height_mm: item.height_mm,
    quantity: item.quantity,
    location_dong: item.location_dong,
    location_line: item.location_line,
    location_floor: item.location_floor,
    location_room: item.location_room,
    location_type: item.location_type,
    location_window_type: item.location_window_type,
    remark: item.remark,
    sort_order: index,
  }));

  const { error: itemsError } = await supabase
    .from('dgflow_order_items')
    .insert(orderItems);

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  // 상태 로그
  await supabase.from('dgflow_order_status_logs').insert({
    order_id: order.id,
    to_status: 'draft',
    changed_by: user.id,
    comment: '주문 생성',
  });

  return NextResponse.json({ data: order }, { status: 201 });
}
