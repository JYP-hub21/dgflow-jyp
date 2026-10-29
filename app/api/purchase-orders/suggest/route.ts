import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission } from '@/lib/auth/role-guard';
import { compareSizes, checkSummary, SUGGEST_MIN_SCORE, type SizeQty } from '@/lib/purchase-order/match';
import { NextRequest, NextResponse } from 'next/server';

/**
 * 짝 후보 찾기 — ERP 작업의뢰서에는 우리 접수번호가 없어 규격 · 수량으로 찾는다.
 *
 *  ?work_order_id=  이 작업의뢰서가 나왔을 법한 포장들 (작업의뢰서를 막 등록했을 때)
 *  ?package_id=     이 포장에서 나왔을 법한 작업의뢰서들 (발주 건 화면에서 고를 때)
 *
 * 자동으로 잇지는 않는다 — 후보만 보이고 사람이 누른다.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasAnyPermission(user, ['order:process', 'work_order:create'])) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  const workOrderId = request.nextUrl.searchParams.get('work_order_id');
  const packageId = request.nextUrl.searchParams.get('package_id');

  if (workOrderId) {
    const { data: items } = await supabase
      .from('dgflow_work_order_items').select('width_mm, height_mm, quantity').eq('work_order_id', workOrderId);
    const { data: pkgs } = await supabase
      .from('dgflow_purchase_order_packages')
      .select('id, label, sheet_name, rows, purchase_order_id, po:dgflow_purchase_orders!inner(intake_number, site_name, customer_name, stage)')
      .is('work_order_id', null)
      .neq('po.stage', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(500);

    const ranked = (pkgs ?? [])
      .map(p => ({ p, check: compareSizes(p.rows as SizeQty[], items ?? []) }))
      .filter(x => x.check.score >= SUGGEST_MIN_SCORE)
      .sort((a, b) => Number(b.check.ok) - Number(a.check.ok) || b.check.score - a.check.score)
      .slice(0, 5)
      .map(({ p, check }) => {
        const po = (Array.isArray(p.po) ? p.po[0] : p.po) as { intake_number: string; site_name: string | null; customer_name: string | null };
        return {
          package_id: p.id,
          package_label: p.label,
          sheet_name: p.sheet_name,
          purchase_order_id: p.purchase_order_id,
          intake_number: po.intake_number,
          site_name: po.site_name,
          customer_name: po.customer_name,
          ok: check.ok,
          score: check.score,
          summary: checkSummary(check),
        };
      });
    return NextResponse.json({ data: ranked });
  }

  if (packageId) {
    const { data: pkg } = await supabase
      .from('dgflow_purchase_order_packages').select('rows').eq('id', packageId).maybeSingle();
    if (!pkg) return NextResponse.json({ error: '포장을 찾을 수 없습니다.' }, { status: 404 });

    // 아직 어느 포장에도 안 붙은 최근 작업의뢰서
    const { data: linked } = await supabase
      .from('dgflow_purchase_order_packages').select('work_order_id').not('work_order_id', 'is', null);
    const taken = new Set((linked ?? []).map(l => l.work_order_id));
    const { data: wos } = await supabase
      .from('dgflow_work_orders')
      .select('id, work_order_number, customer_label, site_label, request_date')
      .order('created_at', { ascending: false })
      .limit(300);
    const free = (wos ?? []).filter(w => !taken.has(w.id));
    const { data: items } = free.length
      ? await supabase.from('dgflow_work_order_items').select('work_order_id, width_mm, height_mm, quantity').in('work_order_id', free.map(w => w.id))
      : { data: [] };

    const ranked = free
      .map(w => ({ w, check: compareSizes(pkg.rows as SizeQty[], (items ?? []).filter(i => i.work_order_id === w.id)) }))
      .filter(x => x.check.score >= SUGGEST_MIN_SCORE)
      .sort((a, b) => Number(b.check.ok) - Number(a.check.ok) || b.check.score - a.check.score)
      .slice(0, 5)
      .map(({ w, check }) => ({
        work_order_id: w.id,
        work_order_number: w.work_order_number,
        customer_label: w.customer_label,
        site_label: w.site_label,
        request_date: w.request_date,
        ok: check.ok,
        score: check.score,
        summary: checkSummary(check),
      }));
    return NextResponse.json({ data: ranked });
  }

  return NextResponse.json({ error: 'work_order_id 또는 package_id 가 필요합니다.' }, { status: 400 });
}
