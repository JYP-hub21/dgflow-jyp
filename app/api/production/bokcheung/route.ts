import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isIsoDate } from '@/lib/production/daily-report';
import { fetchProductionLogs } from '@/lib/production/logs';
import { buildBokcheungSheet, cumulativeOf } from '@/lib/production/bokcheung';
import { buildBokcheungWorkbook } from '@/lib/production/bokcheung-excel';
import { cleanEntries, loadEntries } from '@/lib/production/bokcheung-store';
import { loadLines } from '@/lib/production/lines-store';

/**
 * 복층생산일지 — 회사 양식 그대로의 하루치 (lib/production/bokcheung.ts).
 *   GET  ?date=YYYY-MM-DD           화면 미리보기: 줄 · 저장된 입력값 · 종류 제안
 *   POST ?date=YYYY-MM-DD {entries} 엑셀 내려받기 — 화면에 입력한 값이 저장된 값보다 앞선다
 */
async function prepare(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!hasPermission(user, 'production:view')) {
    return { error: NextResponse.json({ error: '생산 현황을 볼 권한이 없습니다.' }, { status: 403 }) };
  }
  const date = request.nextUrl.searchParams.get('date');
  if (!isIsoDate(date)) {
    return { error: NextResponse.json({ error: '날짜를 YYYY-MM-DD 로 지정해 주세요.' }, { status: 400 }) };
  }
  const supabase = createServiceRoleClient();
  try {
    // 누계를 함께 구하려고 그해 1월 1일부터 읽는다 — 그날 줄은 그 안에서 고른다
    const [logs, { lines }] = await Promise.all([
      fetchProductionLogs(supabase, `${date.slice(0, 4)}-01-01`, date),
      loadLines(supabase),
    ]);
    const sheet = buildBokcheungSheet(logs, date, cumulativeOf(logs), lines);
    const store = await loadEntries(supabase, date, sheet);
    return { user, date, sheet, store };
  } catch (e) {
    return { error: NextResponse.json({ error: e instanceof Error ? e.message : '생산 기록을 읽지 못했습니다.' }, { status: 500 }) };
  }
}

export async function GET(request: NextRequest) {
  const p = await prepare(request);
  if ('error' in p) return p.error;
  return NextResponse.json({
    sheet: p.sheet,
    storage: p.store.storage,
    entries: p.store.entries,
    suggestions: p.store.suggestions,
    canEdit: hasPermission(p.user, 'production:input'),
  });
}

export async function POST(request: NextRequest) {
  const p = await prepare(request);
  if ('error' in p) return p.error;
  const body = await request.json().catch(() => ({}));
  const entries = { ...p.store.entries, ...cleanEntries(p.sheet, body?.entries) };

  const wb = buildBokcheungWorkbook(p.sheet, entries);
  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `복층생산일지_${p.date}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="bokcheung-daily.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
