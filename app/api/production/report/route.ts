import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { buildDailyReport, daysBetween, isIsoDate } from '@/lib/production/daily-report';
import { fetchProductionLogs } from '@/lib/production/logs';

/** 한 번에 뽑을 수 있는 기간 — 1년이면 일지로는 충분하다 */
const MAX_DAYS = 366;

/**
 * GET /api/production/report?from=YYYY-MM-DD&to=YYYY-MM-DD
 * 기간 합계 — 화면 미리보기용 JSON (날짜별로 무엇을 몇 장 만들었나).
 * 엑셀은 회사 양식 그대로의 복층생산일지만 낸다: 하루치 /api/production/bokcheung,
 * 기간(날짜별 시트) /api/production/bokcheung/range. 예전 일지 양식 엑셀은 2026-10-30 에 없앴다
 * ("기간으로 뽑을 때 왜 예전 양식이 나오냐" — 사용자).
 */
export async function GET(request: NextRequest) {
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
  if (from > to) {
    return NextResponse.json({ error: '시작일이 종료일보다 늦습니다.' }, { status: 400 });
  }
  if (daysBetween(from, to) > MAX_DAYS) {
    return NextResponse.json({ error: `기간은 최대 ${MAX_DAYS}일까지 지정할 수 있습니다.` }, { status: 400 });
  }

  let logs;
  try {
    logs = await fetchProductionLogs(createServiceRoleClient(), from, to);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '생산 기록을 읽지 못했습니다.' }, { status: 500 });
  }

  return NextResponse.json(buildDailyReport(logs, from, to));
}
