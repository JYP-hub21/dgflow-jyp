import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { groupBySpec } from '@/lib/erp/grouping';
import { generateOrderNumber } from '@/lib/erp/order-number';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: order } = await supabase
    .from('dgflow_orders')
    .select(`*, customer:dgflow_customers(name, short_name), site:dgflow_sites(site_name)`)
    .eq('id', id).single();

  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: items } = await supabase
    .from('dgflow_order_items')
    .select('*')
    .eq('order_id', id)
    .order('sort_order');

  const customer = order.customer as { name: string; short_name: string };
  const site = order.site as { site_name: string };
  const grouped = groupBySpec(items || []);

  // 당일 주문번호 시퀀스 조회
  const today = order.order_date;
  const { count } = await supabase
    .from('dgflow_orders')
    .select('*', { count: 'exact', head: true })
    .lte('order_date', today)
    .gte('order_date', today);

  const orderNumber = order.order_number || generateOrderNumber(new Date(today), (count || 0) + 1);

  // ERP 16열 양식
  const rows = grouped.map(item => ({
    '주문번호': orderNumber,
    '주문일자': order.order_date,
    '납품일자': order.delivery_date || '',
    '거래처': customer.name,
    '현장명': site.site_name,
    '구분': 'TP',
    '품명': item.product_name,
    '두께': parseTotalThickness(item.product_name),
    '가로규격': item.width_mm,
    '세로규격': item.height_mm,
    '주문수량': item.quantity,
    '출고수량': 0,
    '잔여수량': item.quantity,
    '면적': Math.round(item.width_mm * item.height_mm * item.quantity / 1_000_000 * 100) / 100,
    '미출고액': '',
    '비고': item.location_summary,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 30 },
    { wch: 5 }, { wch: 30 }, { wch: 6 }, { wch: 8 }, { wch: 8 },
    { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'ERP불러오기');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // 주문번호 업데이트
  if (!order.order_number) {
    await supabase.from('dgflow_orders').update({ order_number: orderNumber }).eq('id', id);
  }

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="ERP_${orderNumber}.xlsx"`,
    },
  });
}

/** 품명에서 두께 추출: "24T 6CL+12A+6CL" → 24 */
function parseTotalThickness(productName: string): number {
  const match = productName.match(/^([\d.]+)T/);
  return match ? parseFloat(match[1]) : 0;
}
