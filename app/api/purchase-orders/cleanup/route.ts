import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { PO_BUCKET } from '@/lib/purchase-order/chunks';
import { listPurchaseOrders, logEvent } from '@/lib/purchase-order/server';
import { NextResponse } from 'next/server';

/** 무료 요금제 저장 공간 (프로젝트 전체 1GB) */
const FREE_LIMIT = 1024 * 1024 * 1024;

async function candidates() {
  const supabase = createServiceRoleClient();
  const pos = await listPurchaseOrders(supabase, { limit: 2000 });
  const finished = pos.filter(p => p.derived === 'done' || p.derived === 'cancelled').map(p => p.id);
  const { data: files } = await supabase
    .from('dgflow_purchase_order_files')
    .select('id, purchase_order_id, size_bytes, storage_prefix, chunk_count, purged_at');
  const live = (files ?? []).filter(f => !f.purged_at);
  const used = live.reduce((n, f) => n + Number(f.size_bytes), 0);
  const purgeable = live.filter(f => finished.includes(f.purchase_order_id));
  return { supabase, used, purgeable };
}

/** 저장 공간 — 쓰는 양과, 끝난 건(완료 · 취소)의 파일을 지우면 비는 양 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'master') return NextResponse.json({ error: '마스터만 볼 수 있습니다.' }, { status: 403 });
  const { used, purgeable } = await candidates();
  return NextResponse.json({
    data: {
      used,
      limit: FREE_LIMIT,
      purgeable_bytes: purgeable.reduce((n, f) => n + Number(f.size_bytes), 0),
      purgeable_files: purgeable.length,
    },
  });
}

/**
 * 끝난 건의 파일을 저장소에서 지운다. 기록(파일 이름 · 크기 · 이력)은 남기고 purged_at 만 찍는다.
 * 완료된 건은 이미 작업의뢰서와 생산 기록이 시스템에 있어 원본이 없어도 흐름을 되짚을 수 있다.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'master') return NextResponse.json({ error: '마스터만 정리할 수 있습니다.' }, { status: 403 });
  const { supabase, purgeable } = await candidates();

  let freed = 0;
  const now = new Date().toISOString();
  for (const f of purgeable) {
    const paths = Array.from({ length: f.chunk_count }, (_, i) => `${f.storage_prefix}/${String(i).padStart(4, '0')}`);
    const { error } = await supabase.storage.from(PO_BUCKET).remove(paths);
    if (error) continue;
    await supabase.from('dgflow_purchase_order_files').update({ purged_at: now }).eq('id', f.id);
    freed += Number(f.size_bytes);
  }
  for (const poId of new Set(purgeable.map(f => f.purchase_order_id))) {
    await logEvent(supabase, poId, user.id, 'purged');
  }
  return NextResponse.json({ data: { freed, files: purgeable.length } });
}
