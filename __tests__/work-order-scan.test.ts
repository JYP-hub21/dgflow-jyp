import { describe, it, expect } from 'vitest';
import { verifyScan, expectedArea } from '@/lib/work-order/verify';
import type { WorkOrderInput } from '@/lib/work-order/verify';

/** 검산에 쓰이지 않는 머리글까지 적어 둔다 — 실물이 어떤 문서였는지 남기려고 */
type Fixture = WorkOrderInput & {
  work_order_number: string;
  customer_label: string;
  site_label: string;
  request_date: string;
  delivery_date: string;
};

/**
 * 실물 작업의뢰서 두 장을 그대로 옮겨 놓고 검산 로직을 확인한다.
 *
 * 거래처가 다른데 머리글·열·소계 구조가 완전히 같다 — ERP 가 찍어내는 한 가지 양식이다.
 * 발주서와 달리 작성자가 손댈 여지가 없어서 거래처별 프로파일이 필요 없다.
 */

/** 서해종합건설 26-2286 (울산태화강변A-2BL 2공구) */
const SEOHAE: Fixture = {
  work_order_number: '26-2286',
  customer_label: '(주)서해종합건설',
  site_label: '울산태화강변A-2BL 아파트 건설공사 2공구현장',
  request_date: '2026-08-25',
  delivery_date: '2026-09-29',
  items: [
    { no: 1, product_name: '22T 5newGN+12AR,+5로이', width_mm: 1662, height_mm: 1975, quantity: 18, area_m2: 59.04, remark: '202동 a,b동 1,2,4라인 3~12층주방 外' },
    { no: 2, product_name: '22T 5newGN+12AR,+5로이', width_mm: 762, height_mm: 1975, quantity: 90, area_m2: 135.0, remark: null },
    { no: 3, product_name: '22T 5newGN+12AR,+5로이', width_mm: 612, height_mm: 974, quantity: 144, area_m2: 86.4, remark: null },
    { no: 4, product_name: '22T 5newGN+12AR,+5로이', width_mm: 307, height_mm: 764, quantity: 16, area_m2: 4.48, remark: null },
    { no: 5, product_name: '22T 5newGN+12AR,+5로이', width_mm: 257, height_mm: 764, quantity: 40, area_m2: 11.2, remark: null },
    { no: 6, product_name: '22T 5newGN+12AR,+5로이', width_mm: 457, height_mm: 364, quantity: 56, area_m2: 15.68, remark: null },
    { no: 7, product_name: '22T 5CL+12Ar,+5로이', width_mm: 1657, height_mm: 1964, quantity: 18, area_m2: 58.5, remark: null },
    { no: 8, product_name: '22T 5CL+12Ar,+5로이', width_mm: 757, height_mm: 1964, quantity: 90, area_m2: 134.1, remark: null },
    { no: 9, product_name: '22T 5CL+12Ar,+5로이', width_mm: 607, height_mm: 964, quantity: 144, area_m2: 84.96, remark: null },
    { no: 10, product_name: '22T 5CL+12Ar,+5로이', width_mm: 302, height_mm: 754, quantity: 16, area_m2: 4.48, remark: null },
    { no: 11, product_name: '22T 5CL+12Ar,+5로이', width_mm: 252, height_mm: 754, quantity: 40, area_m2: 11.2, remark: null },
    { no: 12, product_name: '22T 5CL+12Ar,+5로이', width_mm: 452, height_mm: 353, quantity: 56, area_m2: 15.68, remark: null },
    { no: 13, product_name: '22T 5newGN+12A+5로이', width_mm: 257, height_mm: 764, quantity: 72, area_m2: 20.16, remark: '202동 59A-C 1~4라인 3~12층주방+유리 外' },
  ],
  printed_subtotals: [
    { after_no: 6, quantity: 364, area_m2: 311.8 },
    { after_no: 12, quantity: 364, area_m2: 308.92 },
    { after_no: 13, quantity: 72, area_m2: 20.16 },
  ],
  printed_total: { quantity: 800, area_m2: 640.88 },
};

/** 우미건설 26-1952 (남원주 역세권 AC-4BL). 13행 품명은 손글씨 `5newGN` 를 합친 값 */
const UMI: Fixture = {
  work_order_number: '26-1952',
  customer_label: '우미건설(주)',
  site_label: '남원주 역세권 복합용지 AC-4BL 우미린 공동주택현장',
  request_date: '2026-07-24',
  delivery_date: '2026-09-05',
  items: [
    { no: 1, product_name: '22T 5newGN+12AR.+5로이', width_mm: 1719, height_mm: 1820, quantity: 15, area_m2: 46.95, remark: '3동 1~3호 84A,B 21~25F 거실F(外)' },
    { no: 2, product_name: '22T 5newGN+12AR.+5로이', width_mm: 763, height_mm: 1820, quantity: 30, area_m2: 41.7, remark: '3동 1~3호 84A,B 21~25F 거실S(外)' },
    { no: 3, product_name: '22T 5newGN+12AR.+5로이', width_mm: 755, height_mm: 950, quantity: 60, area_m2: 43.2, remark: '3동 1~3호 84A,B 21~25F 침실1,2(外)' },
    { no: 4, product_name: '22T 5newGN+12AR.+5로이', width_mm: 455, height_mm: 950, quantity: 40, area_m2: 17.2, remark: '3동 1~3호 84A,B 21~25F 주방/식당(外)' },
    { no: 5, product_name: '22T 5newGN+12AR.+5로이', width_mm: 305, height_mm: 950, quantity: 40, area_m2: 11.6, remark: '3동 1,3호 84A 21~25F 드레스룸,팬트리(外)' },
    { no: 6, product_name: '22T 5newGN+12AR.+5로이', width_mm: 405, height_mm: 900, quantity: 30, area_m2: 10.8, remark: '3동 1~3호 84A,B 21~25F 발코니2(外)' },
    { no: 7, product_name: '22T 5CL+12Ar.+5로이', width_mm: 1719, height_mm: 1820, quantity: 15, area_m2: 46.95, remark: '3동 1~3호 84A,B 21~25F 거실F(內)' },
    { no: 8, product_name: '22T 5CL+12Ar.+5로이', width_mm: 763, height_mm: 1820, quantity: 30, area_m2: 41.7, remark: '3동 1~3호 84A,B 21~25F 거실S(內)' },
    { no: 9, product_name: '22T 5CL+12Ar.+5로이', width_mm: 755, height_mm: 950, quantity: 60, area_m2: 43.2, remark: '3동 1~3호 84A,B 21~25F 침실1,2(內)' },
    { no: 10, product_name: '22T 5CL+12Ar.+5로이', width_mm: 455, height_mm: 950, quantity: 40, area_m2: 17.2, remark: '3동 1~3호 84A,B 21~25F 주방/식당(內)' },
    { no: 11, product_name: '22T 5CL+12Ar.+5로이', width_mm: 305, height_mm: 950, quantity: 40, area_m2: 11.6, remark: '3동 1,3호 84A 21~25F 드레스룸,팬트리(內)' },
    { no: 12, product_name: '22T 5CL+12Ar.+5로이', width_mm: 405, height_mm: 900, quantity: 30, area_m2: 10.8, remark: '3동 1~3호 84A,B 21~25F 발코니2(內)' },
    { no: 13, product_name: '22T 5newGN+12A+5로이', width_mm: 705, height_mm: 1820, quantity: 20, area_m2: 25.6, remark: '3동 1,2호 84A,B 21~25F 발코니1' },
    { no: 14, product_name: '22T 5newGN+12A+5로이', width_mm: 405, height_mm: 950, quantity: 30, area_m2: 11.4, remark: '3동 1~3호 84A,B 21~25F 하향식피난구' },
  ],
  printed_subtotals: [
    { after_no: 6, quantity: 215, area_m2: 171.45 },
    { after_no: 12, quantity: 215, area_m2: 171.45 },
    { after_no: 14, quantity: 50, area_m2: 37.0 },
  ],
  printed_total: { quantity: 480, area_m2: 379.9 },
};

describe('작업의뢰서 검산', () => {
  it('서해 26-2286 — 소계 3개와 합계가 모두 맞는다', () => {
    const check = verifyScan(SEOHAE);
    expect(check.ok).toBe(true);
    expect(check.blocks).toHaveLength(3);
    expect(check.total?.counted).toEqual({ quantity: 800, area_m2: 640.88 });
  });

  it('우미 26-1952 — 소계 3개와 합계가 모두 맞는다', () => {
    const check = verifyScan(UMI);
    expect(check.ok).toBe(true);
    expect(check.total?.counted).toEqual({ quantity: 480, area_m2: 379.9 });
  });

  it('소계가 품명 블록을 끊는다', () => {
    const check = verifyScan(SEOHAE);
    expect(check.blocks.map((b) => b.product_name)).toEqual([
      '22T 5newGN+12AR,+5로이',
      '22T 5CL+12Ar,+5로이',
      '22T 5newGN+12A+5로이',
    ]);
    expect(check.blocks.map((b) => [b.from_no, b.to_no])).toEqual([
      [1, 6],
      [7, 12],
      [13, 13],
    ]);
  });

  it('수량을 잘못 읽으면 해당 블록과 합계가 어긋난다', () => {
    const misread: Fixture = {
      ...SEOHAE,
      items: SEOHAE.items.map((i) => (i.no === 3 ? { ...i, quantity: 14 } : i)),
    };
    const check = verifyScan(misread);
    expect(check.ok).toBe(false);
    expect(check.blocks[0].quantity_ok).toBe(false);
    expect(check.blocks[1].quantity_ok).toBe(true); // 다른 블록은 멀쩡하다
    expect(check.total?.quantity_ok).toBe(false);
  });

  it('행을 통째로 빠뜨려도 잡힌다', () => {
    const dropped: Fixture = {
      ...SEOHAE,
      items: SEOHAE.items.filter((i) => i.no !== 9),
    };
    const check = verifyScan(dropped);
    expect(check.ok).toBe(false);
    expect(check.blocks[1].counted.quantity).toBe(220); // 364 - 144
  });

  it('소계·합계를 못 읽으면 대조하지 않는다', () => {
    const check = verifyScan({ ...SEOHAE, printed_subtotals: [], printed_total: null });
    expect(check.blocks).toHaveLength(0);
    expect(check.total).toBeNull();
    expect(check.no_printed_total).toBe(true);
  });
});

describe('면적 규칙', () => {
  it('장당 2자리 반올림 후 수량을 곱한다', () => {
    // 1719×1820 = 3.12858 → 3.13 × 15 (migration 010 의 예시)
    expect(expectedArea(1719, 1820, 15)).toBe(46.95);
    expect(expectedArea(763, 1820, 30)).toBe(41.7);
  });

  it('장당 최소 3재(0.28㎡) 가 걸린다', () => {
    // 307×764 = 0.2345 → 그대로면 3.75 지만 실물은 4.48
    expect(expectedArea(307, 764, 16)).toBe(4.48);
    expect(expectedArea(457, 364, 56)).toBe(15.68);
  });

  it('두 실물의 전 행이 면적 규칙과 맞는다', () => {
    expect(verifyScan(SEOHAE).row_warnings).toEqual([]);
    expect(verifyScan(UMI).row_warnings).toEqual([]);
  });

  it('규격을 잘못 읽으면 면적과 어긋나 경고가 뜬다', () => {
    const misread: Fixture = {
      ...UMI,
      items: UMI.items.map((i) => (i.no === 1 ? { ...i, width_mm: 1019 } : i)),
    };
    // 소계·합계는 면적을 그대로 베꼈으니 여전히 맞는다. 규격 오독은 이 경고로만 드러난다.
    const check = verifyScan(misread);
    expect(check.ok).toBe(true);
    expect(check.row_warnings).toEqual([
      { no: 1, printed_area: 46.95, expected_area: 27.75 },
    ]);
  });
});
