import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { PO_BUCKET } from '@/lib/purchase-order/chunks';
import { logEvent } from '@/lib/purchase-order/server';
import { NextRequest, NextResponse } from 'next/server';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

interface FileMeta { id: string; kind: 'erp' | 'spec'; file_name: string; mime_type?: string; size_bytes: number; chunk_count: number }
interface PackageIn { label: string; rows: { location: string; width_mm: number; height_mm: number; quantity: number }[] }

/**
 * ERP 변환 결과를 발주 건에 저장한다 — 만든 ERP 업로드 엑셀 · 규격정리 파일과, 포장(시트)별 행.
 *
 * 포장 행은 나중에 돌아올 작업의뢰서와 짝을 맞추고 대조하는 기준이다.
 * 같은 차수 시트를 다시 저장하면 그 차수의 포장을 갈아 끼운다. 다만 이미 작업의뢰서가
 * 붙은 포장이 있으면 막는다 — 기준이 바뀌면 그 대조 결과가 거짓이 된다.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/purchase-orders/[id]/erp'>) {
  const user = await getCurrentUser();
  if (!user) return bad('Unauthorized', 401);
  if (!hasPermission(user, 'order:process') || !hasPermission(user, 'erp:generate')) {
    return bad('발주서를 처리할 권한이 없습니다.', 403);
  }

  const { id } = await ctx.params;
  const body = await request.json();
  const sheetName = String(body.sheet_name ?? '');
  const files = (Array.isArray(body.files) ? body.files : []) as FileMeta[];
  const packages = (Array.isArray(body.packages) ? body.packages : []) as PackageIn[];
  if (packages.length === 0) return bad('저장할 포장이 없습니다.');

  const supabase = createServiceRoleClient();
  const { data: po } = await supabase.from('dgflow_purchase_orders').select('id, stage').eq('id', id).maybeSingle();
  if (!po) return bad('발주 건을 찾을 수 없습니다.', 404);
  if (po.stage === 'cancelled') return bad('취소된 건입니다.');

  const { data: old } = await supabase
    .from('dgflow_purchase_order_packages').select('id, work_order_id').eq('purchase_order_id', id).eq('sheet_name', sheetName);
  if ((old ?? []).some(p => p.work_order_id)) {
    return bad(`"${sheetName || '이 차수'}" 에는 이미 작업의뢰서가 연결된 포장이 있어 다시 저장할 수 없습니다. 연결을 먼저 끊으세요.`, 409);
  }

  for (const f of files) {
    const { data: objs } = await supabase.storage.from(PO_BUCKET).list(`${id}/${f.id}`, { limit: 1000 });
    if ((objs?.length ?? 0) < f.chunk_count) return bad(`${f.file_name} 이(가) 다 올라가지 않았습니다.`);
  }

  // 같은 차수의 예전 ERP · 규격정리 파일은 지운다 — 어느 것이 최신인지 헷갈리지 않게
  const { data: oldFiles } = await supabase
    .from('dgflow_purchase_order_files').select('id, storage_prefix, chunk_count')
    .eq('purchase_order_id', id).eq('sheet_name', sheetName).in('kind', ['erp', 'spec']);
  for (const f of oldFiles ?? []) {
    const paths = Array.from({ length: f.chunk_count }, (_, i) => `${f.storage_prefix}/${String(i).padStart(4, '0')}`);
    await supabase.storage.from(PO_BUCKET).remove(paths);
  }
  if (oldFiles?.length) await supabase.from('dgflow_purchase_order_files').delete().in('id', oldFiles.map(f => f.id));
  if (old?.length) await supabase.from('dgflow_purchase_order_packages').delete().in('id', old.map(p => p.id));

  if (files.length) {
    const { error } = await supabase.from('dgflow_purchase_order_files').insert(files.map(f => ({
      id: f.id,
      purchase_order_id: id,
      kind: f.kind === 'spec' ? 'spec' : 'erp',
      file_name: f.file_name,
      mime_type: f.mime_type ?? '',
      size_bytes: f.size_bytes,
      storage_prefix: `${id}/${f.id}`,
      chunk_count: f.chunk_count,
      sheet_name: sheetName,
      uploaded_by: user.id,
    })));
    if (error) return bad(error.message, 500);
  }

  const { error: pkgError } = await supabase.from('dgflow_purchase_order_packages').insert(packages.map((p, i) => {
    const rows = (p.rows ?? []).map(r => ({
      location: String(r.location ?? ''),
      width_mm: Number(r.width_mm) || 0,
      height_mm: Number(r.height_mm) || 0,
      quantity: Number(r.quantity) || 0,
    }));
    return {
      purchase_order_id: id,
      sheet_name: sheetName,
      seq: i + 1,
      label: String(p.label || `포장 ${i + 1}`),
      rows,
      total_quantity: rows.reduce((n, r) => n + r.quantity, 0),
    };
  }));
  if (pkgError) return bad(pkgError.message, 500);

  const now = new Date().toISOString();
  await supabase.from('dgflow_purchase_orders').update({
    stage: 'erp_ready',
    erp_saved_at: now,
    updated_at: now,
  }).eq('id', id);
  await logEvent(supabase, id, user.id, 'erp_saved', { sheet_name: sheetName, packages: packages.length });

  return NextResponse.json({ success: true });
}
