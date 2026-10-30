import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_LINES, type ProductionLine } from './lines';
import { isMissingTable } from './bokcheung-store';

export const LINES_TABLE = 'dgflow_production_lines';

/** 호기 목록 — 표가 없으면 기본(1호기 · 2호기)과 storage 'none' */
export async function loadLines(supabase: SupabaseClient): Promise<{ storage: 'db' | 'none'; lines: ProductionLine[] }> {
  const { data, error } = await supabase
    .from(LINES_TABLE)
    .select('line_number, name, sort_order, is_active')
    .order('sort_order')
    .order('line_number');
  if (error) {
    if (isMissingTable(error)) return { storage: 'none', lines: DEFAULT_LINES };
    throw new Error(error.message);
  }
  return { storage: 'db', lines: (data ?? []).length > 0 ? (data as ProductionLine[]) : DEFAULT_LINES };
}
