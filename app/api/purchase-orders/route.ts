import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { PO_BUCKET } from '@/lib/purchase-order/chunks';
import { canProcess, logEvent, nextIntakeNumber } from '@/lib/purchase-order/server';
import { NextRequest, NextResponse } from 'next/server';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FileMeta { id: string; file_name: string; mime_type?: string; size_bytes: number; chunk_count: number }

/**
 * 발주서 접수.
 *
 * 파일은 브라우저가 먼저 저장소 `{발주 건 id}/{파일 id}/` 에 조각으로 올려 두고,
 * 여기서는 조각이 다 올라왔는지 확인한 뒤 건을 만든다. (id 는 브라우저가 미리 정한다)
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return bad('Unauthorized', 401);
  if (!hasPermission(user, 'order:submit')) return bad('발주서를 올릴 권한이 없습니다.', 403);

  const body = await request.json();
  const id = String(body.id ?? '');
  if (!UUID.test(id)) return bad('잘못된 요청입니다.');
  const files = (Array.isArray(body.files) ? body.files : []) as FileMeta[];
  if (files.length === 0) return bad('발주서 파일을 올리세요.');
  if (files.some(f => !UUID.test(String(f.id)) || !f.file_name || !(f.chunk_count > 0))) return bad('파일 정보가 잘못됐습니다.');

  const supabase = createServiceRoleClient();

  if (!body.assignee_id) return bad('담당자를 고르세요.');
  const { data: assignee } = await supabase
    .from('dgflow_users').select('id, role, permissions, status, is_active').eq('id', body.assignee_id).maybeSingle();
  if (!assignee || assignee.status !== 'active' || !assignee.is_active || !canProcess(assignee)) {
    return bad('발주서를 처리할 수 있는 사람만 담당자로 고를 수 있습니다.');
  }

  // 조각이 빠짐없이 올라왔나
  for (const f of files) {
    const { data: objs } = await supabase.storage.from(PO_BUCKET).list(`${id}/${f.id}`, { limit: 1000 });
    if ((objs?.length ?? 0) < f.chunk_count) return bad(`${f.file_name} 이(가) 다 올라가지 않았습니다. 다시 올려 주세요.`);
  }

  // 같은 날 동시에 접수하면 번호가 겹칠 수 있다 — 겹치면 다음 번호로 다시
  let intakeNumber = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    intakeNumber = await nextIntakeNumber(supabase);
    const { error } = await supabase.from('dgflow_purchase_orders').insert({
      id,
      intake_number: intakeNumber,
      customer_name: body.customer_name?.trim() || null,
      site_name: body.site_name?.trim() || null,
      due_date: body.due_date || null,
      memo: body.memo?.trim() || null,
      created_by: user.id,
      assignee_id: assignee.id,
    });
    if (!error) break;
    if (error.code !== '23505' || attempt === 4) return bad(error.message, 500);
  }

  const { error: fileError } = await supabase.from('dgflow_purchase_order_files').insert(files.map(f => ({
    id: f.id,
    purchase_order_id: id,
    kind: 'order',
    file_name: f.file_name,
    mime_type: f.mime_type ?? '',
    size_bytes: f.size_bytes,
    storage_prefix: `${id}/${f.id}`,
    chunk_count: f.chunk_count,
    uploaded_by: user.id,
  })));
  if (fileError) {
    await supabase.from('dgflow_purchase_orders').delete().eq('id', id);
    return bad(fileError.message, 500);
  }

  await logEvent(supabase, id, user.id, 'submitted', { assignee_id: assignee.id, files: files.map(f => f.file_name) });
  return NextResponse.json({ data: { id, intake_number: intakeNumber } }, { status: 201 });
}
