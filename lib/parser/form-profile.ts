/**
 * 발주서 양식 프로파일
 *
 * 발주서는 거래처가 직접 만들기 때문에 작성자마다 다르고, 학습되지 않은 양식이 계속 들어온다.
 * 완벽한 만능 파서는 만들 수 없다 — 대신 **한 번 가르치면 기억하게** 한다.
 *
 * 사원이 화면에서 "이 열이 위치예요" 를 한 번 찍으면 프로파일로 저장되고,
 * 같은 거래처의 다음 발주서는 자동으로 그 지정을 따른다.
 */
import * as XLSX from 'xlsx';
import type { OrderScan, ScanColumns, ScanOverrides } from './order-scan';
import { sheetMatrix } from './order-scan';

export interface FormProfile {
  id?: string;
  name: string;
  customer_hint: string | null;
  site_hint: string | null;
  header_signature: string | null;
  header_row: number | null;
  columns: Partial<ScanColumns>;
  location_source: OrderScan['location_source'] | null;
  verified_at?: string | null;
}

/**
 * 헤더 행의 글자를 이어 붙인 지문.
 *
 * 거래처명을 못 읽어도 이 지문이 같으면 같은 양식으로 본다.
 * 예) `위치|제품명|규격|수량|평수|실리콘|비고`
 */
export function headerSignature(ws: XLSX.WorkSheet | undefined, headerRow: number): string {
  if (!ws || headerRow < 1) return '';
  const row = sheetMatrix(ws)[headerRow - 1] ?? [];
  return row
    .map(c => String(c ?? '').replace(/\s+/g, ''))
    .filter(Boolean)
    .join('|');
}

/**
 * 프로파일 후보 중 가장 잘 맞는 것을 고른다.
 *
 * **거래처나 현장이 맞아야만 적용한다.** 헤더 지문은 혼자서는 근거가 되지 못한다 —
 * 동일유리 표준 발주서 양식을 여러 거래처가 같이 쓰기 때문에 지문이 똑같이 나온다.
 * (우미 남원주와 KCC 여의도의 지문이 `위치|제품명|규격|수량|평수|실리콘|비고` 로 동일한데,
 *  헤더 행은 13행과 12행으로 다르다. 지문만 믿고 KCC 프로파일을 우미에 적용했더니
 *  헤더가 한 줄 밀려 품목이 0건이 됐다.)
 *
 * 그래서 신원(거래처·현장)이 먼저고, 지문은 같은 거래처의 프로파일이 여럿일 때 고르는 데 쓴다.
 */
export function matchProfile(
  profiles: FormProfile[],
  hints: { signature?: string; customer?: string; site?: string },
): FormProfile | null {
  const signature = (hints.signature ?? '').trim();
  const customer = normalize(hints.customer);
  const site = normalize(hints.site);

  const scored = profiles
    .map(p => {
      const siteMatch = !!(site && p.site_hint && overlaps(normalize(p.site_hint), site));
      const customerMatch = !!(customer && p.customer_hint && overlaps(normalize(p.customer_hint), customer));

      // 신원이 맞지 않으면 아무리 양식이 비슷해도 적용하지 않는다
      if (!siteMatch && !customerMatch) return { profile: p, score: 0 };

      let score = 0;
      if (siteMatch) score += 4;
      if (customerMatch) score += 3;
      if (signature && p.header_signature && p.header_signature === signature) score += 3;
      if (p.verified_at) score += 1;
      return { profile: p, score };
    })
    .filter(s => s.score >= 3)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.profile ?? null;
}

/** 프로파일을 스캐너가 쓰는 지정값으로 바꾼다. */
export function toOverrides(profile: FormProfile | null): ScanOverrides {
  if (!profile) return {};
  return {
    header_row: profile.header_row ?? undefined,
    columns: profile.columns ?? {},
    location_source: profile.location_source ?? undefined,
  };
}

/** 현재 스캔 결과를 프로파일로 저장할 모양으로 만든다. */
export function profileFromScan(
  scan: OrderScan,
  name: string,
  hints: { signature?: string; customer?: string; site?: string },
  verified: boolean,
): FormProfile {
  return {
    name,
    customer_hint: hints.customer || null,
    site_hint: hints.site || null,
    header_signature: hints.signature || null,
    header_row: scan.header_row || null,
    columns: scan.columns,
    location_source: scan.location_source,
    verified_at: verified ? new Date().toISOString() : null,
  };
}

const normalize = (s: string | undefined | null) =>
  (s ?? '').replace(/\(주\)|\(유\)|\(사\)|주식회사/g, '').replace(/\s+/g, '').toLowerCase();

/** 한쪽이 다른 쪽을 포함하면 같은 대상으로 본다 (표기 흔들림 대응) */
function overlaps(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  // 앞 4글자가 같으면 같은 거래처로 본다 ("KCC건설" vs "KCC건설㈜")
  return a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4);
}
