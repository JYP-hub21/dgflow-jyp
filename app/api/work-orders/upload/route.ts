import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { parseWorkOrderExcel } from '@/lib/parser/work-order-excel';
import { NextRequest, NextResponse } from 'next/server';

// POST: 바이투 엑셀 업로드 → 작업의뢰서 일괄 생성
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 권한 체크: 경영지원팀, 시스템관리자만
  if (!['biz_support', 'system_admin'].includes(user.role)) {
    return NextResponse.json({ error: '경영지원팀 또는 시스템관리자만 업로드할 수 있습니다.' }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const mode = formData.get('mode') as string || 'preview'; // 'preview' | 'create'

  if (!file) {
    return NextResponse.json({ error: '파일이 필요합니다.' }, { status: 400 });
  }

  // 엑셀 파싱
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const result = parseWorkOrderExcel(buffer);

  if (result.workOrders.length === 0) {
    return NextResponse.json({
      error: '파싱 결과가 비어있습니다.',
      errors: result.errors,
    }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // 중복 의뢰번호 체크
  const woNumbers = result.workOrders.map(wo => wo.work_order_number);
  const { data: existing } = await supabase
    .from('dgflow_work_orders')
    .select('work_order_number')
    .in('work_order_number', woNumbers);

  const existingNumbers = new Set((existing || []).map(e => e.work_order_number));
  const newWorkOrders = result.workOrders.filter(wo => !existingNumbers.has(wo.work_order_number));
  const skippedNumbers = woNumbers.filter(n => existingNumbers.has(n));

  // 미리보기 모드: 파싱 결과만 반환
  if (mode === 'preview') {
    return NextResponse.json({
      preview: true,
      totalRows: result.totalRows,
      workOrders: result.workOrders.map(wo => ({
        work_order_number: wo.work_order_number,
        customer_name: wo.customer_name,
        site_name: wo.site_name,
        item_count: wo.items.length,
        total_quantity: wo.items.reduce((s, i) => s + i.quantity, 0),
        is_duplicate: existingNumbers.has(wo.work_order_number),
      })),
      newCount: newWorkOrders.length,
      skippedCount: skippedNumbers.length,
      skippedNumbers,
      errors: result.errors,
    });
  }

  // 생성 모드: 실제 DB 삽입
  if (newWorkOrders.length === 0) {
    return NextResponse.json({
      error: '생성할 작업의뢰서가 없습니다. 모든 의뢰번호가 이미 존재합니다.',
      skippedNumbers,
    }, { status: 400 });
  }

  const createdOrders: { work_order_number: string; id: string; item_count: number }[] = [];

  for (const wo of newWorkOrders) {
    // 작업의뢰서 생성
    const { data: workOrder, error: woError } = await supabase
      .from('dgflow_work_orders')
      .insert({
        order_id: null,
        work_order_number: wo.work_order_number,
        customer_name: wo.customer_name,
        site_name: wo.site_name,
        source: 'upload',
        request_date: new Date().toISOString().split('T')[0],
      })
      .select('id')
      .single();

    if (woError) {
      return NextResponse.json({
        error: `작업의뢰서 ${wo.work_order_number} 생성 실패: ${woError.message}`,
        created: createdOrders,
      }, { status: 500 });
    }

    // 품목 삽입
    const woItems = wo.items.map(item => ({
      work_order_id: workOrder.id,
      product_name: item.product_name,
      thickness: item.thickness,
      width_mm: item.width_mm,
      height_mm: item.height_mm,
      quantity: item.quantity,
      remark: item.remark,
      sort_order: item.sort_order,
    }));

    const { error: itemError } = await supabase
      .from('dgflow_work_order_items')
      .insert(woItems);

    if (itemError) {
      return NextResponse.json({
        error: `작업의뢰서 ${wo.work_order_number} 품목 삽입 실패: ${itemError.message}`,
        created: createdOrders,
      }, { status: 500 });
    }

    createdOrders.push({
      work_order_number: wo.work_order_number,
      id: workOrder.id,
      item_count: woItems.length,
    });
  }

  return NextResponse.json({
    created: createdOrders,
    createdCount: createdOrders.length,
    skippedCount: skippedNumbers.length,
    skippedNumbers,
    errors: result.errors,
  }, { status: 201 });
}
