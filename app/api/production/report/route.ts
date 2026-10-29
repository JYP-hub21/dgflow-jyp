import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import {
  buildDailyReport, daysBetween, isIsoDate, type ProductionLogRow,
} from '@/lib/production/daily-report';
import { buildDailyReportWorkbook } from '@/lib/production/daily-report-excel';

/** 한 번에 뽑을 수 있는 기간 — 1년이면 일지로는 충분하다 */
const MAX_DAYS = 366;
const PAGE = 1000;

/**
 * GET /api/production/report?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|xlsx
 * 일간 생산일지. json 은 화면 미리보기, xlsx 는 내려받기.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:view')) {
    return NextResponse.json({ error: '생산 현황을 볼 권한이 없습니다.' }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return NextResponse.json({ error: '기간을 YYYY-MM-DD 로 지정해 주세요.' }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: '시작일이 종료일보다 늦습니다.' }, { status: 400 });
  }
  if (daysBetween(from, to) > MAX_DAYS) {
    return NextResponse.json({ error: `기간은 최대 ${MAX_DAYS}일까지 지정할 수 있습니다.` }, { status: 400 });
  }

  // 작업의뢰서 품목은 anon 세션으로 조회가 막히므로 권한 확인 뒤 서비스 키로 읽는다
  const supabase = createServiceRoleClient();
  const raw: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('dgflow_production_logs')
      .select(`
        production_date, quantity_completed, area_m2, shift, line_number, work_order_id, work_order_item_id,
        item:dgflow_work_order_items(product_name, width_mm, height_mm, sort_order),
        work_order:dgflow_work_orders(
          work_order_number, customer_label, site_label,
          order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name))
        ),
        creator:dgflow_users!created_by(name)
      `)
      .gte('production_date', from)
      .lte('production_date', to)
      .order('production_date')
      .order('created_at')
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    raw.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const logs: ProductionLogRow[] = raw.map((r) => {
    const item = one(r.item) as { product_name?: string; width_mm?: number; height_mm?: number; sort_order?: number } | null;
    const wo = one(r.work_order) as (WorkOrderLabelSource & { work_order_number?: string }) | null;
    const labels = wo ? workOrderLabels(wo) : { customer: null, site: null };
    return {
      production_date: r.production_date as string,
      quantity_completed: r.quantity_completed as number,
      area_m2: r.area_m2 as number | null,
      shift: r.shift as string | null,
      line_number: r.line_number as number | null,
      work_order_id: r.work_order_id as string,
      work_order_item_id: r.work_order_item_id as string | null,
      work_order_number: wo?.work_order_number ?? '-',
      customer: labels.customer,
      site: labels.site,
      product_name: item?.product_name ?? '(품목 없음)',
      width_mm: item?.width_mm ?? null,
      height_mm: item?.height_mm ?? null,
      sort_order: item?.sort_order ?? null,
      created_by_name: (one(r.creator) as { name?: string } | null)?.name ?? null,
    };
  });

  const report = buildDailyReport(logs, from, to);

  if (params.get('format') !== 'xlsx') return NextResponse.json(report);

  const printedAt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date());
  const wb = await buildDailyReportWorkbook(report, printedAt);
  const buffer = await wb.xlsx.writeBuffer();
  const fileName = from === to ? `일간생산일지_${from}.xlsx` : `일간생산일지_${from}_${to}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="daily-production.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}

/** Supabase 조인은 타입상 배열로 올 수 있다 — 하나만 쓴다 */
function one(v: unknown) {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}
