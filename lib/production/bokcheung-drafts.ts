import type { BokcheungEntry } from './bokcheung';

/**
 * 복층생산일지 입력값의 이 PC 임시 저장 (브라우저 localStorage, 날짜별).
 * 서버 표(dgflow_bokcheung_entries)가 생기기 전에도 입력이 사라지지 않게, 그리고 기간 엑셀을 만들 때
 * 날짜마다 적어 둔 값을 함께 보내려고 쓴다. 저장소를 못 쓰는 브라우저(사생활 보호 창 등)에서는 조용히 넘어간다.
 */
const key = (date: string) => `dgflow:bokcheung:${date}`;

export function readDraft(date: string): Record<string, BokcheungEntry> {
  try { return JSON.parse(localStorage.getItem(key(date)) ?? 'null') ?? {}; } catch { return {}; }
}

export function writeDraft(date: string, entries: Record<string, BokcheungEntry>) {
  try { localStorage.setItem(key(date), JSON.stringify(entries)); } catch { /* 저장소를 못 쓰면 화면 값만 쓴다 */ }
}

/** 기간 안의 날짜마다 임시 저장해 둔 값 (있는 날만) */
export function readDraftsBetween(from: string, to: string, maxDays = 366): Record<string, Record<string, BokcheungEntry>> {
  const out: Record<string, Record<string, BokcheungEntry>> = {};
  const d = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < maxDays; i++) {
    const date = d.toISOString().slice(0, 10);
    if (date > to) break;
    const draft = readDraft(date);
    if (Object.keys(draft).length > 0) out[date] = draft;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
