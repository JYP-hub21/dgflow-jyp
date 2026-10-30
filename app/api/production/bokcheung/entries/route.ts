import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isIsoDate } from '@/lib/production/daily-report';
import { ENTRIES_TABLE, isMissingTable } from '@/lib/production/bokcheung-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /api/production/bokcheung/entries — 복층생산일지 종류 · 수량외 저장.
 * body: { date, entries: [{ line, work_order_id, composition, glass_type, quantity_note }] }
 * 생산 입력 권한이 있어야 한다. 표가 아직 없으면 503 { code: 'NO_TABLE' } — 화면은 임시 저장으로 남긴다.
 */
export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:input')) {
    return NextResponse.json({ error: '생산 실적을 입력할 권한이 없습니다.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const date = body?.date;
  const list = Array.isArray(body?.entries) ? body.entries : null;
  if (!isIsoDate(date) || !list || list.length === 0 || list.length > 500) {
    return NextResponse.json({ error: '저장할 값이 올바르지 않습니다.' }, { status: 400 });
  }

  const rows = [];
  for (const e of list) {
    const line = Number(e?.line);
    const workOrderId = String(e?.work_order_id ?? '');
    const composition = String(e?.composition ?? '').trim();
    // 호기는 편집으로 늘 수 있다 (lib/production/lines.ts)
    if (!Number.isInteger(line) || line < 1 || line > 99 || !UUID.test(workOrderId) || !composition || composition.length > 200) {
      return NextResponse.json({ error: '저장할 줄을 알아보지 못했습니다.' }, { status: 400 });
    }
    rows.push({
      production_date: date,
      line_number: line,
      work_order_id: workOrderId,
      composition,
      glass_type: String(e?.glass_type ?? '').trim().slice(0, 20),
      quantity_note: String(e?.quantity_note ?? '').trim().slice(0, 40),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });
  }

  const { error } = await createServiceRoleClient()
    .from(ENTRIES_TABLE)
    .upsert(rows, { onConflict: 'production_date,line_number,work_order_id,composition' });
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ error: '입력값을 저장할 표가 아직 없습니다.', code: 'NO_TABLE' }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: rows.length });
}
