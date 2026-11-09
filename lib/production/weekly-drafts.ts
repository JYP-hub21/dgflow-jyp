import type { WeeklyDayEntry } from './weekly';

/**
 * 주간생산일지 입력값의 이 PC 임시 저장 (브라우저 localStorage, 주별).
 * 서버 표(dgflow_weekly_log_days)가 생기기 전에도 입력이 사라지지 않게 쓴다.
 * 저장소를 못 쓰는 브라우저(사생활 보호 창 등)에서는 조용히 넘어간다.
 */
const key = (monday: string) => `dgflow:weekly:${monday}`;

export function readWeeklyDraft(monday: string): Record<string, WeeklyDayEntry> {
  try { return JSON.parse(localStorage.getItem(key(monday)) ?? 'null') ?? {}; } catch { return {}; }
}

export function writeWeeklyDraft(monday: string, entries: Record<string, WeeklyDayEntry>) {
  try { localStorage.setItem(key(monday), JSON.stringify(entries)); } catch { /* 저장소를 못 쓰면 화면 값만 쓴다 */ }
}
