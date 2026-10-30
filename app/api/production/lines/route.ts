import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasAnyPermission, hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { LINES_TABLE, loadLines } from '@/lib/production/lines-store';
import { isMissingTable } from '@/lib/production/bokcheung-store';

/**
 * 생산 라인(호기) 목록.
 *   GET            → { storage, lines }  (표가 없으면 1호기 · 2호기, storage 'none')
 *   PUT { lines }  → 이름 바꾸기 · 새 호기 더하기 · 안 쓰기(is_active=false). 지우지는 않는다 — 지난 기록이 그 번호를 쓴다.
 * 고치는 것은 생산 입력 권한(생산관리부) 또는 마스터 관리 권한.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await loadLines(createServiceRoleClient()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '호기를 읽지 못했습니다.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasAnyPermission(user, ['production:input', 'admin:master'])) {
    return NextResponse.json({ error: '호기를 고칠 권한이 없습니다.' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const input = Array.isArray(body?.lines) ? body.lines : null;
  if (!input || input.length === 0 || input.length > 20) {
    return NextResponse.json({ error: '호기 목록이 올바르지 않습니다.' }, { status: 400 });
  }

  const rows: { line_number: number; name: string; sort_order: number; is_active: boolean; updated_at: string }[] = [];
  const names = new Set<string>();
  for (const [i, l] of input.entries()) {
    const n = Number(l?.line_number);
    const name = String(l?.name ?? '').trim().slice(0, 20);
    if (!Number.isInteger(n) || n < 1 || n > 99) return NextResponse.json({ error: '호기 번호가 올바르지 않습니다.' }, { status: 400 });
    if (!name) return NextResponse.json({ error: '호기 이름을 입력하세요.' }, { status: 400 });
    if (names.has(name)) return NextResponse.json({ error: `같은 이름이 두 번 있습니다: ${name}` }, { status: 400 });
    names.add(name);
    rows.push({ line_number: n, name, sort_order: i + 1, is_active: l?.is_active !== false, updated_at: new Date().toISOString() });
  }
  if (!rows.some(r => r.is_active)) return NextResponse.json({ error: '쓰는 호기가 하나는 있어야 합니다.' }, { status: 400 });

  const { error } = await createServiceRoleClient().from(LINES_TABLE).upsert(rows, { onConflict: 'line_number' });
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ error: '호기 표가 아직 데이터베이스에 없습니다.', code: 'NO_TABLE' }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: rows.length, canEdit: hasPermission(user, 'production:input') });
}
