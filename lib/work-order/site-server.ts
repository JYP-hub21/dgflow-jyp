import type { SupabaseClient } from '@supabase/supabase-js';
import { isSite, type ProductionSite } from './site';

/** 생산 공장 · 외주 업체를 고칠 수 있는 사람 — 작업의뢰서를 다루는 업무지원부와 마스터 */
export const SITE_EDITORS = ['work_order:create', 'order:process', 'admin:master'];

/** 현장별 공사 담당자를 정할 수 있는 사람 — 위 사람들 + 공사관리부(자기 현장을 자기로) */
export const CONTACT_EDITORS = [...SITE_EDITORS, 'order:submit'];

/** 외주 업체 입력값 다듬기 — 글자 수를 막아 둔다 */
export function cleanPartner(body: Record<string, unknown>) {
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return { name: s(body.name, 40), contact_name: s(body.contact_name, 20), phone: s(body.phone, 20), memo: s(body.memo, 200) };
}

/** 생산 공장 값 확인 — 외주면 있는 업체를 골라야 한다 (작업의뢰서 등록 · 바꾸기가 같이 쓴다) */
export async function validateSite(
  supabase: SupabaseClient, body: { production_site?: unknown; outsource_partner_id?: unknown },
): Promise<{ error: string } | { production_site: ProductionSite; outsource_partner_id: string | null }> {
  const site = body.production_site ?? 'ochang';
  if (!isSite(site)) return { error: '생산 공장 값이 올바르지 않습니다.' };
  if (site === 'ochang') return { production_site: site, outsource_partner_id: null };
  const partnerId = typeof body.outsource_partner_id === 'string' ? body.outsource_partner_id : '';
  if (!partnerId) return { error: '외주 업체를 선택하세요.' };
  const { data } = await supabase.from('dgflow_outsource_partners').select('id').eq('id', partnerId).maybeSingle();
  if (!data) return { error: '외주 업체를 찾지 못했습니다.' };
  return { production_site: site, outsource_partner_id: partnerId };
}
