import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { daysBetween, isIsoDate } from '@/lib/production/daily-report';
import { fetchProductionLogs } from '@/lib/production/logs';
import { buildBokcheungRange } from '@/lib/production/bokcheung';
import { buildBokcheungRangeWorkbook } from '@/lib/production/bokcheung-excel';
import { entriesForRange } from '@/lib/production/bokcheung-store';
import { loadLines } from '@/lib/production/lines-store';

/** 한 파일에 넣는 기간 — 회사 파일도 한 해에 한 파일이다 */
const MAX_DAYS = 366;

/**
 * POST /api/production/bokcheung/range?from=YYYY-MM-DD&to=YYYY-MM-DD
 * body: { drafts?: { [날짜]: { [줄 열쇠]: { glass_type, quantity_note } } } } — 화면이 그 PC 에 임시 저장해 둔 입력값
 *
 * 기간의 복층생산일지를 날짜마다 시트 한 장씩 넣은 엑셀 (복층 생산이 있는 날만).
 * 회사 복층생산일지(2026).xlsx 와 같은 시트라 회사 파일로 옮겨 이어 붙일 수 있다.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'production:view')) {
    return NextResponse.json({ error: '생산 현황을 볼 권한이 없습니다.' }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return NextResponse.json({ error: '기간을 YYYY-MM-DD 로 지정해 주세요.' }, { status: 400 });
  }
  if (from > to) return NextResponse.json({ error: '시작일이 종료일보다 늦습니다.' }, { status: 400 });
  if (daysBetween(from, to) > MAX_DAYS) {
    return NextResponse.json({ error: `기간은 최대 ${MAX_DAYS}일까지 지정할 수 있습니다.` }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const supabase = createServiceRoleClient();
  let days;
  try {
    // 날짜마다 그해 누계를 내려고 시작일이 속한 해 1월 1일부터 읽는다
    const [logs, { lines }] = await Promise.all([
      fetchProductionLogs(supabase, `${from.slice(0, 4)}-01-01`, to),
      loadLines(supabase),
    ]);
    const sheets = buildBokcheungRange(logs, from, to, lines);
    if (sheets.length === 0) {
      return NextResponse.json({ error: '이 기간에 입력된 복층 생산실적이 없습니다.' }, { status: 400 });
    }
    const entries = await entriesForRange(supabase, from, to, sheets, body?.drafts);
    days = sheets.map(sheet => ({ sheet, entries: entries[sheet.date] ?? {} }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '생산 기록을 읽지 못했습니다.' }, { status: 500 });
  }

  const buffer = await buildBokcheungRangeWorkbook(days).xlsx.writeBuffer();
  const fileName = from === to ? `복층생산일지_${from}.xlsx` : `복층생산일지_${from}_${to}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="bokcheung-range.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'X-Sheet-Count': String(days.length),
    },
  });
}
