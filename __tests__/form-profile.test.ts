// @vitest-environment node
/**
 * 양식 프로파일 매칭 테스트.
 *
 * ── 이 테스트가 생긴 이유 ──────────────────────────────────
 * 헤더 지문만으로 프로파일을 고르게 했더니, **KCC 프로파일이 우미 발주서에 적용돼
 * 품목이 0건이 됐다.** 두 거래처가 동일유리 표준 발주서 양식을 같이 쓰기 때문에
 * 지문(`위치|제품명|규격|수량|평수|실리콘|비고`)이 똑같이 나오는데,
 * 헤더 행은 12행과 13행으로 달라서 한 줄이 밀려 전부 깨졌다.
 *
 * 잘못된 프로파일이 조용히 적용되면 사원은 "이 발주서는 안 읽히나 보다" 하고 넘어간다.
 * 그래서 **신원(거래처·현장)이 맞을 때만 적용한다**를 못 박아 둔다.
 */
import { describe, it, expect } from 'vitest';
import { matchProfile, type FormProfile } from '@/lib/parser/form-profile';

/** 두 거래처가 같이 쓰는 동일유리 표준 발주서 양식의 지문 */
const SHARED_SIGNATURE = '위치|제품명|규격|수량|평수|실리콘|비고';

const kcc: FormProfile = {
  name: 'KCC건설 여의도 오피스텔',
  customer_hint: 'KCC건설',
  site_hint: '여의도 오피스텔 신축공사 현장',
  header_signature: SHARED_SIGNATURE,
  header_row: 12,
  columns: { remark: 8 },
  location_source: 'remark-column',
  verified_at: '2026-09-22T00:00:00.000Z',
};

const umi: FormProfile = {
  name: '우미건설 남원주 역세권1차',
  customer_hint: '우미건설',
  site_hint: '우미-남원주 역세권1차',
  header_signature: SHARED_SIGNATURE,
  header_row: 13,
  columns: { location: 0 },
  location_source: 'location-column',
  verified_at: null,
};

describe('양식 프로파일 매칭', () => {
  it('지문이 같아도 거래처가 다르면 적용하지 않는다', () => {
    const matched = matchProfile([kcc], {
      signature: SHARED_SIGNATURE,
      customer: '우미건설',
      site: '우미-남원주 역세권1차',
    });
    expect(matched).toBeNull();
  });

  it('현장이 맞으면 적용한다', () => {
    const matched = matchProfile([kcc, umi], {
      signature: SHARED_SIGNATURE,
      customer: 'KCC건설',
      site: '여의도 오피스텔 신축공사 현장',
    });
    expect(matched?.name).toBe('KCC건설 여의도 오피스텔');
    expect(matched?.header_row).toBe(12);
  });

  it('같은 거래처의 다른 현장이면 거래처 일치만으로 적용한다', () => {
    const matched = matchProfile([kcc], {
      signature: SHARED_SIGNATURE,
      customer: 'KCC건설',
      site: '부산 오피스텔 신축',
    });
    expect(matched?.name).toBe('KCC건설 여의도 오피스텔');
  });

  it('거래처 표기가 흔들려도 찾는다', () => {
    const matched = matchProfile([kcc], { customer: '(주)KCC건설', site: '' });
    expect(matched?.name).toBe('KCC건설 여의도 오피스텔');
  });

  it('거래처·현장을 하나도 못 읽으면 아무것도 적용하지 않는다', () => {
    expect(matchProfile([kcc, umi], { signature: SHARED_SIGNATURE })).toBeNull();
  });

  it('후보가 여럿이면 현장까지 맞는 쪽을 고른다', () => {
    const other: FormProfile = { ...kcc, name: 'KCC건설 (현장 미지정)', site_hint: null };
    const matched = matchProfile([other, kcc], {
      signature: SHARED_SIGNATURE,
      customer: 'KCC건설',
      site: '여의도 오피스텔 신축공사 현장',
    });
    expect(matched?.name).toBe('KCC건설 여의도 오피스텔');
  });

  it('저장된 프로파일이 없으면 null', () => {
    expect(matchProfile([], { customer: 'KCC건설' })).toBeNull();
  });
});
