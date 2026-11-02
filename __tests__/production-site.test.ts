import { describe, expect, it } from 'vitest';
import { itemNo } from '@/lib/production/item-view';
import { numberRows } from '@/lib/work-order/numbering';
import { isSite, partnerContactText, siteText, telHref, toWorkOrderSite } from '@/lib/work-order/site';

describe('품목 번호 — 종이 작업의뢰서의 NO 그대로', () => {
  it('저장된 NO 가 있으면 그것, 없으면 등록 순서 + 1 (정렬과 상관없이 같은 번호)', () => {
    expect(itemNo({ item_no: 7, sort_order: 2 })).toBe(7);
    expect(itemNo({ item_no: null, sort_order: 2 })).toBe(3);
    expect(itemNo({}, 4)).toBe(5);
  });

  it('등록 화면 — 문서에서 읽은 번호는 그대로, 손으로 더한 줄은 앞 번호에 이어서', () => {
    expect(numberRows([{ no: 1 }, { no: 2 }, { no: 3 }])).toEqual([1, 2, 3]);
    // 3번 줄을 지워도 4번은 4번 (예전에는 채워진 줄 순서라 3번이 됐다)
    expect(numberRows([{ no: 1 }, { no: 2 }, { no: 4 }])).toEqual([1, 2, 4]);
    // 끝에 손으로 두 줄 더함
    expect(numberRows([{ no: 1 }, { no: 2 }, { no: '' }, { no: '' }])).toEqual([1, 2, 3, 4]);
    // 아무것도 안 읽고 손으로만 친 의뢰서
    expect(numberRows([{ no: '' }, {}, { no: null }])).toEqual([1, 2, 3]);
  });
});

describe('생산 공장 — 오창공장 · 외주', () => {
  const partner = { name: '한빛유리', contact_name: '김담당', phone: '010-1234-5678' };

  it('DB 줄을 화면 꼴로 — 조인 결과가 배열이어도, 값이 없으면 오창공장', () => {
    expect(toWorkOrderSite({ production_site: 'outsource', outsource_partner: [partner] })).toEqual({ site: 'outsource', partner });
    expect(toWorkOrderSite({ production_site: 'outsource', outsource_partner: partner }).partner?.name).toBe('한빛유리');
    expect(toWorkOrderSite({})).toEqual({ site: 'ochang', partner: null });
    expect(toWorkOrderSite({ production_site: 'ochang', outsource_partner: null }).site).toBe('ochang');
  });

  it('보이는 글 · 전화 걸기 링크', () => {
    expect(siteText({ site: 'ochang', partner: null })).toBe('오창공장');
    expect(siteText({ site: 'outsource', partner })).toBe('외주 · 한빛유리');
    expect(siteText({ site: 'outsource', partner: null })).toBe('외주 (업체 미정)');
    expect(partnerContactText(partner)).toBe('김담당 010-1234-5678');
    expect(partnerContactText({ ...partner, contact_name: '' })).toBe('010-1234-5678');
    expect(telHref('010-1234-5678')).toBe('tel:01012345678');
    expect(isSite('outsource') && isSite('ochang') && !isSite('home')).toBe(true);
  });
});
