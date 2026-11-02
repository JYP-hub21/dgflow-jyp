/**
 * 생산 공장 — 오창공장에서 만들지, 다른 공장에 외주를 줄지 (2026-11-02 사용자 요청).
 *
 * 업무지원부가 작업의뢰서마다 고른다. 공사개발부는 자기가 올린 발주서가 어디서 만들어지는지,
 * 외주면 누구에게 전화해 진행을 물을지 안다. 외주 업체는 표 dgflow_outsource_partners 에 모아 두고 고른다
 * (supabase/migrations/20261102_021_production_site_item_no.sql).
 *
 * 생산 현황(오창공장의 할 일)에는 오창 작업의뢰서만 나오고, 외주는 따로 모아 본다.
 */
export type ProductionSite = 'ochang' | 'outsource';

export const SITE_LABEL: Record<ProductionSite, string> = {
  ochang: '오창공장',
  outsource: '외주',
};

export interface OutsourcePartner {
  id: string;
  name: string;
  contact_name: string;
  phone: string;
  memo: string;
  is_active: boolean;
}

/** 작업의뢰서의 생산 공장 정보 — 화면에 보이는 꼴 */
export interface WorkOrderSite {
  site: ProductionSite;
  partner: Pick<OutsourcePartner, 'name' | 'contact_name' | 'phone'> | null;
}

export const isSite = (v: unknown): v is ProductionSite => v === 'ochang' || v === 'outsource';

/** "오창공장" · "외주 · 한빛유리" · "외주 (업체 미정)" */
export function siteText(s: WorkOrderSite): string {
  if (s.site === 'ochang') return SITE_LABEL.ochang;
  return s.partner ? `외주 · ${s.partner.name}` : '외주 (업체 미정)';
}

/** 외주 담당자 — "김담당 010-1234-5678" (없으면 빈 글) */
export function partnerContactText(p: WorkOrderSite['partner']): string {
  if (!p) return '';
  return [p.contact_name, p.phone].filter(Boolean).join(' ');
}

/** 전화 걸기 링크 (폰에서 누르면 바로 건다) */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`;
}

/** DB 줄 → 화면 꼴. partner 는 조인 결과(객체 또는 배열) */
export function toWorkOrderSite(row: { production_site?: string | null; outsource_partner?: unknown }): WorkOrderSite {
  const raw = Array.isArray(row.outsource_partner) ? row.outsource_partner[0] : row.outsource_partner;
  const p = raw as { name?: string; contact_name?: string; phone?: string } | null | undefined;
  return {
    site: row.production_site === 'outsource' ? 'outsource' : 'ochang',
    partner: p?.name ? { name: p.name, contact_name: p.contact_name ?? '', phone: p.phone ?? '' } : null,
  };
}

/** 조인할 때 쓰는 select 조각 */
export const SITE_SELECT = 'production_site, outsource_partner:dgflow_outsource_partners(name, contact_name, phone)';
