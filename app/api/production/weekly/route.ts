import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isIsoDate } from '@/lib/production/daily-report';
import { fetchProductionLogs } from '@/lib/production/logs';
import { DEFAULT_SETTINGS, autoOutputs, buildWeeklySheet, weekOf, weeklyLineNumbers } from '@/lib/production/weekly';
import { buildWeeklyWorkbook } from '@/lib/production/weekly-excel';
import { WEEKLY_TABLE, cleanEntries, loadWeeklyEntries } from '@/lib/production/weekly-store';
import { isMissingTable } from '@/lib/production/bokcheung-store';
import { loadLines } from '@/lib/production/lines-store';
import { activeLines, lineName } from '@/lib/production/lines';

/**
 * 주간생산일지 — 회사 양식 그대로의 한 주 (lib/production/weekly.ts).
 *   GET  ?date=YYYY-MM-DD           화면: 그 주 · 저장된 입력값 · 생산 기록에서 나눈 복층 / 3복층
 *   POST ?date=YYYY-MM-DD {entries} 엑셀 내려받기 — 화면에 입력한 값이 저장된 값보다 앞선다
 *   PUT  ?date=YYYY-MM-DD {entries} 입력값 저장 (표가 없으면 503 NO_TABLE — 화면은 임시 저장으로 남긴다)
 */
async function prepare(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!hasPermission(user, 'production:view')) {
    return { error: NextResponse.json({ error: '생산 현황을 볼 권한이 없습니다.' }, { status: 403 }) };
  }
  const date = request.nextUrl.searchParams.get('date');
  if (!isIsoDate(date)) {
    return { error: NextResponse.json({ error: '날짜를 YYYY-MM-DD 로 지정하세요.' }, { status: 400 }) };
  }
  return { user, week: weekOf(date) };
}

const sundayAfter = (saturday: string) => {
  const d = new Date(`${saturday}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function readWeek(days: string[]) {
  const supabase = createServiceRoleClient();
  const [logs, store, { lines }] = await Promise.all([
    // 일요일까지 읽는다 — 양식은 월–토라 표에는 안 들어가지만, 있으면 화면이 알린다
    fetchProductionLogs(supabase, days[0], sundayAfter(days[days.length - 1])),
    loadWeeklyEntries(supabase, days),
    loadLines(supabase),
  ]);
  return { auto: autoOutputs(logs), store, lines };
}

export async function GET(request: NextRequest) {
  const p = await prepare(request);
  if ('error' in p) return p.error;
  try {
    const { auto, store } = await readWeek(p.week.days);
    return NextResponse.json({
      week: p.week,
      auto,
      entries: store.entries,
      storage: store.storage,
      canEdit: hasPermission(p.user, 'production:input'),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '생산 기록을 읽지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const p = await prepare(request);
  if ('error' in p) return p.error;
  const body = await request.json().catch(() => ({}));
  let buffer;
  try {
    const { auto, store, lines } = await readWeek(p.week.days);
    const entries = { ...store.entries, ...cleanEntries(p.week.days, body?.entries) };
    const numbers = weeklyLineNumbers(activeLines(lines).map(l => l.line_number), entries, auto);
    const sheet = buildWeeklySheet(p.week.monday, entries, auto, DEFAULT_SETTINGS, numbers);
    buffer = await buildWeeklyWorkbook(sheet, entries, DEFAULT_SETTINGS, n => lineName(lines, n)).xlsx.writeBuffer();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '엑셀을 만들지 못했습니다.' }, { status: 500 });
  }
  const fileName = `주간생산일지_${p.week.sheetName}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="weekly-log.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}

export async function PUT(request: NextRequest) {
  const p = await prepare(request);
  if ('error' in p) return p.error;
  if (!hasPermission(p.user, 'production:input')) {
    return NextResponse.json({ error: '생산 실적을 입력할 권한이 없습니다.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const entries = cleanEntries(p.week.days, body?.entries);
  const rows = Object.entries(entries).map(([key, e]) => {
    const [work_date, line] = key.split('|');
    return { work_date, line_number: Number(line), ...e, updated_by: p.user.id, updated_at: new Date().toISOString() };
  });
  if (rows.length === 0) return NextResponse.json({ error: '저장할 값이 올바르지 않습니다.' }, { status: 400 });

  const { error } = await createServiceRoleClient()
    .from(WEEKLY_TABLE)
    .upsert(rows, { onConflict: 'work_date,line_number' });
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ error: '입력값을 저장할 표가 아직 없습니다.', code: 'NO_TABLE' }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: rows.length });
}
