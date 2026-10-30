import type { SupabaseClient } from '@supabase/supabase-js';
import { rowKey, type BokcheungEntry, type BokcheungSheet } from './bokcheung';

/**
 * 복층생산일지의 사람 입력 칸(종류 · 수량외) 저장소 — 표 dgflow_bokcheung_entries
 * (supabase/migrations/20261030_019_bokcheung_entries.sql).
 *
 * 표를 만들기 전에도 화면 · 엑셀은 동작한다: 읽을 때 표가 없으면 storage 'none' 을 돌려주고,
 * 화면은 입력값을 그 PC 에 임시로 들고 있다가 엑셀을 만들 때 함께 보낸다.
 */
export const ENTRIES_TABLE = 'dgflow_bokcheung_entries';

export type EntriesStorage = 'db' | 'none';

/** 표가 아직 없다는 오류인가 (Postgres 42P01 · PostgREST PGRST205) */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205'
    || /does not exist|could not find the table/i.test(error.message ?? '');
}

export async function loadEntries(supabase: SupabaseClient, date: string, sheet: BokcheungSheet): Promise<{
  storage: EntriesStorage;
  entries: Record<string, BokcheungEntry>;
  /** 종류 제안 — 같은 재료 구성에 예전에 적은 종류 (가장 최근 것) */
  suggestions: Record<string, string>;
}> {
  const { data, error } = await supabase
    .from(ENTRIES_TABLE)
    .select('line_number, work_order_id, composition, glass_type, quantity_note')
    .eq('production_date', date);
  if (error) {
    if (isMissingTable(error)) return { storage: 'none', entries: {}, suggestions: {} };
    throw new Error(error.message);
  }

  const entries: Record<string, BokcheungEntry> = {};
  for (const e of data ?? []) {
    entries[rowKey(e.line_number, e.work_order_id, e.composition)] = {
      glass_type: e.glass_type ?? '', quantity_note: e.quantity_note ?? '',
    };
  }

  const rows = sheet.blocks.flatMap(b => b.rows);
  const need = [...new Set(rows.filter(r => !entries[r.key]?.glass_type).map(r => r.composition))];
  const suggestions: Record<string, string> = {};
  if (need.length > 0) {
    const { data: prev } = await supabase
      .from(ENTRIES_TABLE)
      .select('composition, glass_type, production_date')
      .in('composition', need)
      .neq('glass_type', '')
      .order('production_date', { ascending: false })
      .limit(1000);
    const latest = new Map<string, string>();
    for (const p of prev ?? []) if (!latest.has(p.composition)) latest.set(p.composition, p.glass_type);
    for (const r of rows) {
      const g = latest.get(r.composition);
      if (g && !entries[r.key]?.glass_type) suggestions[r.key] = g;
    }
  }
  return { storage: 'db', entries, suggestions };
}

/**
 * 기간 엑셀용 — 날짜마다 넣을 입력값을 정한다.
 * 저장된 값 > 그 PC 임시 저장(drafts, 날짜별) > 같은 재료로 예전에 적은 종류. 표가 없으면 임시 저장 > 제안이 없다.
 */
export async function entriesForRange(
  supabase: SupabaseClient, from: string, to: string, sheets: BokcheungSheet[], drafts: unknown,
): Promise<Record<string, Record<string, BokcheungEntry>>> {
  const saved: Record<string, Record<string, BokcheungEntry>> = {};
  let storage: EntriesStorage = 'db';
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from(ENTRIES_TABLE)
      .select('production_date, line_number, work_order_id, composition, glass_type, quantity_note')
      .gte('production_date', from)
      .lte('production_date', to)
      .order('production_date')
      .range(offset, offset + 999);
    if (error) {
      if (isMissingTable(error)) { storage = 'none'; break; }
      throw new Error(error.message);
    }
    for (const e of data ?? []) {
      (saved[e.production_date] ??= {})[rowKey(e.line_number, e.work_order_id, e.composition)] = {
        glass_type: e.glass_type ?? '', quantity_note: e.quantity_note ?? '',
      };
    }
    if (!data || data.length < 1000) break;
  }

  // 종류 제안 — 재료 구성마다 가장 최근에 적은 종류
  const typeOf = new Map<string, string>();
  if (storage === 'db') {
    const comps = [...new Set(sheets.flatMap(s => s.blocks.flatMap(b => b.rows.map(r => r.composition))))];
    if (comps.length > 0) {
      const { data: prev } = await supabase
        .from(ENTRIES_TABLE)
        .select('composition, glass_type, production_date')
        .in('composition', comps)
        .neq('glass_type', '')
        .order('production_date', { ascending: false })
        .limit(1000);
      for (const p of prev ?? []) if (!typeOf.has(p.composition)) typeOf.set(p.composition, p.glass_type);
    }
  }

  const draftsByDate = drafts && typeof drafts === 'object' ? drafts as Record<string, unknown> : {};
  const out: Record<string, Record<string, BokcheungEntry>> = {};
  for (const sheet of sheets) {
    const draft = cleanEntries(sheet, draftsByDate[sheet.date]);
    const day: Record<string, BokcheungEntry> = {};
    for (const r of sheet.blocks.flatMap(b => b.rows)) {
      day[r.key] = (storage === 'db' ? saved[sheet.date]?.[r.key] : undefined)
        ?? draft[r.key]
        ?? { glass_type: typeOf.get(r.composition) ?? '', quantity_note: '' };
    }
    out[sheet.date] = day;
  }
  return out;
}

/** 화면이 보낸 입력값을 그날 줄에 있는 열쇠만 남기고 다듬는다 */
export function cleanEntries(sheet: BokcheungSheet, input: unknown): Record<string, BokcheungEntry> {
  const keys = new Set(sheet.blocks.flatMap(b => b.rows.map(r => r.key)));
  const out: Record<string, BokcheungEntry> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!keys.has(k) || !v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    out[k] = {
      glass_type: String(e.glass_type ?? '').trim().slice(0, 20),
      quantity_note: String(e.quantity_note ?? '').trim().slice(0, 40),
    };
  }
  return out;
}
