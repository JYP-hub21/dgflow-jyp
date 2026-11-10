import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { PO_BUCKET } from '@/lib/purchase-order/chunks';
import { listPurchaseOrders, logEvent } from '@/lib/purchase-order/server';
import { cleanupPlan, pickPurgeable, type CleanupFileRow } from '@/lib/purchase-order/cleanup';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { NextRequest, NextResponse } from 'next/server';

/** 무료 요금제 저장 공간 (프로젝트 전체 1GB) */
const FREE_LIMIT = 1024 * 1024 * 1024;

/**
 * 끝난 건과 지울 수 있는 파일. 발주 건 · 파일을 **다 읽지 못하면 던진다** — 예전에는 파일 목록이 1,000줄에서 잘리고
 * 포장을 덜 읽은 건이 '완료' 로 계산될 수 있어, 진행 중인 발주서 원본이 지워질 수 있었다 (2026-11-10 점검).
 */
async function plan() {
  const supabase = createServiceRoleClient();
  const pos = await listPurchaseOrders(supabase, { limit: Infinity });
  const files = await fetchAll<CleanupFileRow>((a, b) => supabase
    .from('dgflow_purchase_order_files')
    .select('id, purchase_order_id, kind, file_name, size_bytes, storage_prefix, chunk_count, purged_at')
    .order('id')
    .range(a, b));
  return { supabase, plan: cleanupPlan(pos, files) };
}

const failed = (e: unknown) => {
  console.error('[purchase-orders/cleanup]', e);
  return NextResponse.json({ error: '발주 건을 끝까지 읽지 못해 정리하지 않았습니다. 잠시 뒤 다시 시도하세요.' }, { status: 500 });
};

/** 저장 공간 — 쓰는 양과, 끝난 건(완료 · 취소)별로 지우면 비는 파일 (확인 창이 건마다 보여 준다) */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'master') return NextResponse.json({ error: '마스터만 볼 수 있습니다.' }, { status: 403 });
  try {
    const { plan: p } = await plan();
    return NextResponse.json({
      data: {
        used: p.used,
        limit: FREE_LIMIT,
        purgeable_bytes: p.purgeable.reduce((n, f) => n + Number(f.size_bytes), 0),
        purgeable_files: p.purgeable.length,
        orders: p.orders,
      },
    });
  } catch (e) {
    return failed(e);
  }
}

/**
 * 고른 끝난 건의 파일을 저장소에서 지운다. 기록(파일 이름 · 크기 · 이력)은 남기고 purged_at 만 찍는다.
 * 완료된 건은 이미 작업의뢰서와 생산 기록이 시스템에 있어 원본이 없어도 흐름을 되짚을 수 있다.
 *
 * body: { purchase_order_ids: string[] } — 확인 창에서 사람이 고른 발주 건만 지운다 (2026-11-10 점검: 예전에는
 * "파일 n개를 지울까요?" 한 줄로 어느 발주서인지 모른 채 끝난 건 전부를 지웠다). 고른 건이 그사이 진행 중으로
 * 돌아갔으면 지우지 않는다 — 서버가 단계를 다시 계산해 끝난 건만 남긴다.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'master') return NextResponse.json({ error: '마스터만 정리할 수 있습니다.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body?.purchase_order_ids) ? (body.purchase_order_ids as unknown[]).map(String) : [];
  if (ids.length === 0) return NextResponse.json({ error: '삭제할 발주서를 선택하세요.' }, { status: 400 });

  let ctx;
  try {
    ctx = await plan();
  } catch (e) {
    return failed(e);
  }
  const { supabase } = ctx;
  const targets = pickPurgeable(ctx.plan, ids);

  let freed = 0;
  let purged = 0;
  const now = new Date().toISOString();
  const done = new Map<string, string[]>();
  for (const f of targets) {
    const paths = Array.from({ length: f.chunk_count }, (_, i) => `${f.storage_prefix}/${String(i).padStart(4, '0')}`);
    const { error } = await supabase.storage.from(PO_BUCKET).remove(paths);
    if (error) continue;
    const { error: markError } = await supabase.from('dgflow_purchase_order_files').update({ purged_at: now }).eq('id', f.id);
    if (markError) continue;
    freed += Number(f.size_bytes);
    purged += 1;
    done.set(f.purchase_order_id, [...(done.get(f.purchase_order_id) ?? []), f.file_name]);
  }
  for (const [poId, names] of done) {
    await logEvent(supabase, poId, user.id, 'purged', { files: names });
  }
  return NextResponse.json({ data: { freed, files: purged, failed: targets.length - purged, orders: done.size } });
}
