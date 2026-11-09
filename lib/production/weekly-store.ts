import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTable, type EntriesStorage } from './bokcheung-store';
import { CREW_COLUMNS, dayKey, type CrewKey, type WeeklyDayEntry } from './weekly';

/**
 * 주간생산일지의 사람 입력 칸 저장소 — 표 dgflow_weekly_log_days
 * (supabase/migrations/20261106_023_weekly_log.sql).
 *
 * 표를 만들기 전에도 화면 · 엑셀은 동작한다: 읽을 때 표가 없으면 storage 'none' 을 돌려주고,
 * 화면은 입력값을 그 PC 에 임시로 들고 있다가 엑셀을 만들 때 함께 보낸다 (복층생산일지와 같은 방식).
 */
export const WEEKLY_TABLE = 'dgflow_weekly_log_days';

const COLUMNS = 'work_date, line_number, shift_type, work_hours, barcode_qty, crew, reason, double_jo, double_m2, triple_jo, triple_m2';

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function loadWeeklyEntries(supabase: SupabaseClient, days: string[]): Promise<{
  storage: EntriesStorage;
  entries: Record<string, WeeklyDayEntry>;
}> {
  const { data, error } = await supabase
    .from(WEEKLY_TABLE)
    .select(COLUMNS)
    .gte('work_date', days[0])
    .lte('work_date', days[days.length - 1]);
  if (error) {
    if (isMissingTable(error)) return { storage: 'none', entries: {} };
    throw new Error(error.message);
  }
  const entries: Record<string, WeeklyDayEntry> = {};
  for (const r of data ?? []) {
    entries[dayKey(r.work_date, r.line_number)] = cleanEntry({ ...r, crew: r.crew ?? {} });
  }
  return { storage: 'db', entries };
}

/** 화면이 보낸 하루치를 다듬는다 — 길이 · 숫자만 확인한다 */
export function cleanEntry(input: unknown): WeeklyDayEntry {
  const e = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const crewIn = (e.crew && typeof e.crew === 'object' ? e.crew : {}) as Record<string, unknown>;
  const crew: Partial<Record<CrewKey, string>> = {};
  for (const c of CREW_COLUMNS) {
    const name = String(crewIn[c.key] ?? '').trim().slice(0, 40);
    if (name) crew[c.key] = name;
  }
  return {
    shift_type: String(e.shift_type ?? '').trim().slice(0, 20),
    work_hours: toNumber(e.work_hours),
    barcode_qty: toNumber(e.barcode_qty),
    crew,
    reason: String(e.reason ?? '').slice(0, 1000),
    double_jo: toNumber(e.double_jo),
    double_m2: toNumber(e.double_m2),
    triple_jo: toNumber(e.triple_jo),
    triple_m2: toNumber(e.triple_m2),
  };
}

/** 화면이 보낸 입력값을 이번 주 날짜 · 호기(1–99) 열쇠만 남기고 다듬는다 */
export function cleanEntries(days: string[], input: unknown): Record<string, WeeklyDayEntry> {
  const out: Record<string, WeeklyDayEntry> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const [date, line] = k.split('|');
    const n = Number(line);
    if (days.includes(date) && Number.isInteger(n) && n >= 1 && n <= 99) out[k] = cleanEntry(v);
  }
  return out;
}
