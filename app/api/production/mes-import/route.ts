import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isIsoDate } from '@/lib/production/daily-report';
import { isMissingTable } from '@/lib/production/bokcheung-store';
import { fetchMesDailyTotals, toMesRow } from '@/lib/production/mes-db';
import { MES_COMMIT_ENABLED, MES_TABLE, normalizeWorkOrderNumber, type MesGroup } from '@/lib/production/mes';

/** 한 번에 받는 줄 — 화면이 나눠 보낸다 */
const MAX_GROUPS = 2000;

/**
 * MES 생산실적 → MES 실적 표 (lib/production/mes.ts · mes-db.ts, 2026-11-15 작업의뢰서 없이 넣는 방식).
 *
 *   GET                                   → 지금 표에 들어 있는 MES 실적 (기간 · 장수 · 마지막 등록)
 *   POST { mode: 'commit', file, groups } → 날짜 · 호기 · 주야간 · 의뢰번호 · NO 열쇠로 덮어쓴다(같은 파일을 다시 올려도 두 번 세지 않는다)
 *   POST { mode: 'clear', from, to }      → 그 기간 MES 실적을 지운다(다시 올리기 전에)
 * 생산 입력 권한이 있어야 한다.
 */
async function guard() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!hasPermission(user, 'production:input')) {
    return { error: NextResponse.json({ error: '생산 실적을 입력할 권한이 없습니다.' }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const g = await guard();
  if ('error' in g) return g.error;
  const supabase = createServiceRoleClient();
  try {
    const days = await fetchMesDailyTotals(supabase, '2000-01-01', '2999-12-31');
    const { data: last, error } = await supabase.from(MES_TABLE).select('imported_at, source_file')
      .order('imported_at', { ascending: false }).limit(1);
    if (error && !isMissingTable(error)) throw new Error(error.message);
    return NextResponse.json({
      days: days.length,
      from: days[0]?.date ?? null,
      to: days[days.length - 1]?.date ?? null,
      quantity: days.reduce((s, d) => s + d.quantity, 0),
      lastImport: last?.[0] ?? null,
      table: !error,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'MES 실적을 읽지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const g = await guard();
  if ('error' in g) return g.error;
  const body = await request.json().catch(() => null);
  const supabase = createServiceRoleClient();

  if (body?.mode === 'clear') {
    const { from, to } = body;
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) return NextResponse.json({ error: '기간이 올바르지 않습니다.' }, { status: 400 });
    const { error, count } = await supabase.from(MES_TABLE).delete({ count: 'exact' }).gte('production_date', from).lte('production_date', to);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: count ?? 0 });
  }

  if (body?.mode !== 'commit') return NextResponse.json({ error: '요청을 알아보지 못했습니다.' }, { status: 400 });
  if (!MES_COMMIT_ENABLED) {
    return NextResponse.json({ error: '시험 단계라 아직 등록하지 않습니다. 미리보기만 할 수 있습니다.' }, { status: 403 });
  }
  const raw = Array.isArray(body.groups) ? (body.groups as Partial<MesGroup>[]) : [];
  if (raw.length === 0 || raw.length > MAX_GROUPS) {
    return NextResponse.json({ error: `한 번에 ${MAX_GROUPS}줄까지 보낼 수 있습니다.` }, { status: 400 });
  }
  const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
  const file = str(body.file, 200) || null;
  const rows = [];
  for (const x of raw) {
    const wo = normalizeWorkOrderNumber(x?.wo);
    const ok = wo && Number.isInteger(x.no) && x.no! > 0 && x.no! < 100_000 && typeof x.date === 'string' && isIsoDate(x.date)
      && Number.isInteger(x.line) && x.line! >= 1 && x.line! <= 99 && (x.shift === 'day' || x.shift === 'night')
      && Number.isInteger(x.scanned) && x.scanned! >= 0 && Number.isInteger(x.filled) && x.filled! >= 0
      && x.scanned! + x.filled! > 0 && x.scanned! + x.filled! <= 100_000
      && Number.isFinite(Number(x.width ?? 0)) && Number.isFinite(Number(x.height ?? 0));
    if (!ok) return NextResponse.json({ error: '보낸 실적 중 형식이 맞지 않는 줄이 있습니다.' }, { status: 400 });
    rows.push({
      ...toMesRow({
        wo: wo!, no: x.no!, date: x.date!, line: x.line!, shift: x.shift!, scanned: x.scanned!, filled: x.filled!,
        width: Math.round(Number(x.width) || 0), height: Math.round(Number(x.height) || 0),
        product: str(x.product, 200), customer: str(x.customer, 200), site: str(x.site, 300), remark: str(x.remark, 300),
      }),
      source_file: file,
      imported_by: g.user.id,
      imported_at: new Date().toISOString(),
    });
  }
  const { error } = await supabase.from(MES_TABLE)
    .upsert(rows, { onConflict: 'production_date,line_number,shift,work_order_number,item_no' });
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: 'MES 실적 표가 아직 없습니다. 관리자에게 알려 주세요.' }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: rows.length, quantity: rows.reduce((s, r) => s + r.quantity, 0) });
}
