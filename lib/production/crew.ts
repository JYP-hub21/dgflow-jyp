/**
 * 생산 인원 명단 — 표 dgflow_crew_members (supabase/migrations/20261109_026_crew_members.sql).
 *
 * 주간생산일지 투입 인원 칸에서 고른다. 이름은 공개 저장소에 두지 않고 표에만 있다.
 * 조직도 표기와 예전 일지 표기가 다른 사람이 있어 다른 표기는 aliases 로 찾기만 한다. (실제 이름은 이 저장소에 적지 않는다)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTable, type EntriesStorage } from './bokcheung-store';

export const CREW_TABLE = 'dgflow_crew_members';

export interface CrewMember {
  id: string;
  name: string;
  full_name: string;
  department: string;
  position: string;
  aliases: string[];
  sort_order: number;
  active: boolean;
}

/** 명단 읽기 — 표가 없으면 storage 'none' 과 빈 목록 */
export async function loadCrew(supabase: SupabaseClient): Promise<{ storage: EntriesStorage; members: CrewMember[] }> {
  const { data, error } = await supabase
    .from(CREW_TABLE)
    .select('id, name, full_name, department, position, aliases, sort_order, active')
    .order('sort_order')
    .order('name');
  if (error) {
    if (isMissingTable(error)) return { storage: 'none', members: [] };
    throw new Error(error.message);
  }
  return { storage: 'db', members: (data ?? []) as CrewMember[] };
}

/** 조직도 성명 칸 "가나다(GANA DA)" → 이름 · 영문. 괄호가 겹친 오타("라마바(RAMA BA))")도 받는다 */
export function splitOrgName(raw: string): { name: string; english: string } {
  const t = raw.trim();
  const m = t.match(/^([^(]+?)\s*\((.*)$/);
  if (!m) return { name: t, english: '' };
  return { name: m[1].trim(), english: m[2].replace(/\)+\s*$/, '').trim() };
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * 찾기 — 이름 · 다른 표기 · 영문 · 직급 어디든 들어 있으면. 빈 글자면 전부.
 * 그만둔 사람(active=false)은 빼고, 이름이 앞에서 맞는 사람을 위로.
 */
export function searchCrew(members: CrewMember[], query: string): CrewMember[] {
  const q = norm(query);
  const live = members.filter(m => m.active);
  if (!q) return live;
  const hit = (m: CrewMember) => [m.name, m.full_name, m.position, ...m.aliases].some(v => norm(v).includes(q));
  const starts = (m: CrewMember) => [m.name, ...m.aliases].some(v => norm(v).startsWith(q));
  return live.filter(hit).sort((a, b) => Number(starts(b)) - Number(starts(a)));
}
