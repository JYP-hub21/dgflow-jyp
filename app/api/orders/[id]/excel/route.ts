import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

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

  if (!order) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: items } = await supabase
    .from('dgflow_order_items')
    .select('*')
    .eq('order_id', id)
    .order('sort_order');

  const customer = order.customer as { name: string; short_name: string };
  const site = order.site as { site_name: string };

  // 엑셀 데이터 구성
  const rows = (items || []).map((item, idx) => ({
    'No': idx + 1,
    '품명': item.product_name,
    '가로(mm)': item.width_mm,
    '세로(mm)': item.height_mm,
    '수량': item.quantity,
    '면적(m²)': Number(item.area_m2),
    '동': item.location_dong || '',
    '라인': item.location_line || '',
    '층': item.location_floor || '',
    '위치': item.location_room || '',
    '비고': item.remark || '',
  }));

  // 합계 행 추가
  rows.push({
    'No': 0,
    '품명': '합 계',
    '가로(mm)': 0,
    '세로(mm)': 0,
    '수량': rows.reduce((s, r) => s + (r['수량'] as number), 0),
    '면적(m²)': Math.round(rows.reduce((s, r) => s + (r['면적(m²)'] as number), 0) * 100) / 100,
    '동': '', '라인': '', '층': '', '위치': '', '비고': '',
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // 컬럼 너비 설정
  ws['!cols'] = [
    { wch: 5 }, { wch: 30 }, { wch: 10 }, { wch: 10 },
    { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 8 },
    { wch: 10 }, { wch: 12 }, { wch: 20 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, '주문의뢰서');

  // 헤더 정보 시트
  const headerWs = XLSX.utils.aoa_to_sheet([
    ['주문의뢰서'],
    ['업체명', customer.name],
    ['현장명', site.site_name],
    ['주문일', order.order_date],
    ['납품일', order.delivery_date || '-'],
  ]);
  XLSX.utils.book_append_sheet(wb, headerWs, '기본정보');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="order_${id.slice(0, 8)}.xlsx"`,
    },
  });
}
