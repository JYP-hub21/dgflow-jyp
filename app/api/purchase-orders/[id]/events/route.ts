import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission, ORDER_ANY } from '@/lib/auth/role-guard';
import { logEvent } from '@/lib/purchase-order/server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * 열람 기록 — 파일을 내려받거나 ERP 변환 화면에서 열 때 브라우저가 부른다.
 *
 * **담당자 본인**이 처음 열면 그때가 "확인" 이다. 등록자는 이걸로 담당자가 받아 봤는지 안다.
 * 다른 사람이 열면 기록만 남고 확인으로 치지 않는다 — 대신 맡으려면 담당자를 자기로 바꾼다.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/purchase-orders/[id]/events'>) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasAnyPermission(user, ORDER_ANY)) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

  const { id } = await ctx.params;
  const { action, file_id } = await request.json();
  if (action !== 'downloaded' && action !== 'erp_opened') {
    return NextResponse.json({ error: '알 수 없는 기록입니다.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: po } = await supabase
    .from('dgflow_purchase_orders').select('id, stage, assignee_id').eq('id', id).maybeSingle();
  if (!po) return NextResponse.json({ error: '발주 건을 찾을 수 없습니다.' }, { status: 404 });

  let fileName: string | null = null;
  if (file_id) {
    const { data: f } = await supabase
      .from('dgflow_purchase_order_files').select('file_name').eq('id', file_id).eq('purchase_order_id', id).maybeSingle();
    fileName = f?.file_name ?? null;
  }
  await logEvent(supabase, id, user.id, action, fileName ? { file_name: fileName } : {});

  let checked = false;
  if (po.stage === 'submitted' && po.assignee_id === user.id) {
    const now = new Date().toISOString();
    await supabase.from('dgflow_purchase_orders')
      .update({ stage: 'checked', checked_at: now, checked_by: user.id, updated_at: now })
      .eq('id', id).eq('stage', 'submitted');
    await logEvent(supabase, id, user.id, 'checked');
    checked = true;
  }

  return NextResponse.json({ success: true, checked });
}
