// @vitest-environment node
/**
 * 실제 발주서 → 실제 작업의뢰서 대조 테스트.
 *
 * 기준 자료: 발주서(우미건설-남원주 역세권1차) 5차 시트의 3동 1~3호
 *          → 동일유리 작업의뢰서 26-1952 (스캔본)
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import {
  buildWorkOrder,
  filterByPackaging,
  parsePackagingInstruction,
  formatUnitRange,
  formatTypes,
  sheetArea,
  pickRoom,
  type WorkOrderSourceItem,
} from '@/lib/work-order/build';
import { parseOrderExcel } from '@/lib/parser/excel-order';
import { buildPackagingCandidates } from '@/lib/work-order/packaging';

const ORDER_FILE = path.join(process.cwd(), '발주서(우미건설-남원주 역세권1차) (11).xlsx');
const hasFixture = fs.existsSync(ORDER_FILE);

/**
 * 실제 업로드 경로 그대로 읽는다 — 엑셀 파서를 거쳐 작업의뢰서 입력으로 변환한다.
 */
function readSheet(sheetName: string): { rows: WorkOrderSourceItem[]; packagingText: string } {
  const buf = fs.readFileSync(ORDER_FILE);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  const parsed = parseOrderExcel(ab, sheetName);
  const rows: WorkOrderSourceItem[] = parsed.items.map(i => ({
    product_name: i.product_name,
    width_mm: Number(i.width_mm),
    height_mm: Number(i.height_mm),
    quantity: Number(i.quantity),
    location_dong: i.location_dong,
    location_line: i.location_line,
    location_floor: i.location_floor,
    location_type: i.location_type,
    location_room: i.location_room,
  }));

  const wb = XLSX.readFile(ORDER_FILE);
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '' });
  return { rows, packagingText: String((raw[11] as unknown[])?.[0] ?? '') };
}

describe('면적 계산', () => {
  it('장당 면적을 반올림한 뒤 수량을 곱한다', () => {
    // 작업의뢰서 1번 항목: 1,719 × 1,820 × 15장 = 46.95 (46.93 아님)
    expect(sheetArea(1719, 1820, 15)).toBe(46.95);
    expect(sheetArea(763, 1820, 30)).toBe(41.7);
    expect(sheetArea(755, 950, 60)).toBe(43.2);
    expect(sheetArea(455, 950, 40)).toBe(17.2);
    expect(sheetArea(305, 950, 40)).toBe(11.6);
    expect(sheetArea(405, 900, 30)).toBe(10.8);
    expect(sheetArea(705, 1820, 20)).toBe(25.6);
    expect(sheetArea(405, 950, 30)).toBe(11.4);
  });
});

describe('비고 표기 규칙', () => {
  it('연속한 호는 물결로, 끊긴 호는 쉼표로 묶는다', () => {
    expect(formatUnitRange(['1호', '2호', '3호'])).toBe('1~3호');
    expect(formatUnitRange(['1호', '3호'])).toBe('1,3호');
    expect(formatUnitRange(['1호', '2호'])).toBe('1,2호');
    expect(formatUnitRange(['1호'])).toBe('1호');
  });

  it('같은 숫자 접두사의 타입은 접두사를 한 번만 쓴다', () => {
    expect(formatTypes(['84A', '84B'])).toBe('84A,B');
    expect(formatTypes(['84A', '84A'])).toBe('84A');
    expect(formatTypes(['84A', '59B'])).toBe('84A,59B');
  });
});

describe('포장 지시 해석', () => {
  it('"1,3,4동( 1,2,3호 포장,4,5호 포장)" 을 포장 단위로 나눈다', () => {
    const groups = parsePackagingInstruction(
      ' 1,3,4동( 1,2,3호 포장,4,5호 포장),2동(1,2호 포장 , 3,4,5호포장 ) , 5동 ( 1,2,3호 포장 )'
    );
    const labels = groups.map(g => g.label);

    expect(labels).toContain('3동 1~3호');
    expect(labels).toContain('3동 4,5호');
    expect(labels).toContain('2동 1,2호');
    expect(labels).toContain('2동 3~5호');
    expect(labels).toContain('5동 1~3호');
    expect(groups).toHaveLength(9); // 1·3·4동 각 2개 + 2동 2개 + 5동 1개
  });
});

describe.skipIf(!hasFixture)('실제 작업의뢰서 재현 (26-1952 / 3동 1~3호)', () => {
  function build() {
    const { rows } = readSheet('5차');
    const target = filterByPackaging(rows, { dong: '3동', units: ['1호', '2호', '3호'] });
    return buildWorkOrder(target);
  }

  it('발주서 상단 포장 지시에 3동 1~3호가 들어 있다', () => {
    const { packagingText } = readSheet('5차');
    const labels = parsePackagingInstruction(packagingText).map(g => g.label);
    expect(labels).toContain('3동 1~3호');
  });

  it('품목 14줄, 합계 480장 / 379.90㎡ 로 떨어진다', () => {
    const result = build();
    expect(result.items).toHaveLength(14);
    expect(result.total_quantity).toBe(480);
    expect(result.total_area).toBe(379.9);
  });

  it('품명 묶음별 소계가 215/171.45, 215/171.45, 50/37.00 이다', () => {
    const result = build();
    expect(result.groups).toHaveLength(3);
    expect(result.groups.map(g => [g.subtotal_quantity, g.subtotal_area])).toEqual([
      [215, 171.45],
      [215, 171.45],
      [50, 37],
    ]);
  });

  it('14줄이 스캔본과 규격·수량·면적·비고까지 같다', () => {
    const result = build();
    const actual = result.items.map(i => [`${i.width_mm}x${i.height_mm}`, i.quantity, i.area_m2, i.remark]);

    expect(actual).toEqual([
      ['1719x1820', 15, 46.95, '3동 1~3호 84A,B 21~25F 거실F(外)'],
      ['763x1820', 30, 41.7, '3동 1~3호 84A,B 21~25F 거실S(外)'],
      ['755x950', 60, 43.2, '3동 1~3호 84A,B 21~25F 침실1,2(外)'],
      ['455x950', 40, 17.2, '3동 1~3호 84A,B 21~25F 주방/식당(外)'],
      ['305x950', 40, 11.6, '3동 1,3호 84A 21~25F 드레스룸,팬트리(外)'],
      ['405x900', 30, 10.8, '3동 1~3호 84A,B 21~25F 발코니2(外)'],

      ['1719x1820', 15, 46.95, '3동 1~3호 84A,B 21~25F 거실F(內)'],
      ['763x1820', 30, 41.7, '3동 1~3호 84A,B 21~25F 거실S(內)'],
      ['755x950', 60, 43.2, '3동 1~3호 84A,B 21~25F 침실1,2(內)'],
      ['455x950', 40, 17.2, '3동 1~3호 84A,B 21~25F 주방/식당(內)'],
      ['305x950', 40, 11.6, '3동 1,3호 84A 21~25F 드레스룸,팬트리(內)'],
      ['405x900', 30, 10.8, '3동 1~3호 84A,B 21~25F 발코니2(內)'],

      ['705x1820', 20, 25.6, '3동 1,2호 84A,B 21~25F 발코니1'],
      ['405x950', 30, 11.4, '3동 1~3호 84A,B 21~25F 하향식피난구'],
    ]);
  });

  it('품명은 묶음 첫 줄에만 붙는다 (양식이 병합 셀)', () => {
    const result = build();
    expect(result.items.filter(i => i.is_product_head).map(i => i.no)).toEqual([1, 7, 13]);
  });
});

describe('포장 단위 후보', () => {
  const items = [
    { location_dong: '3동', location_line: '1호', quantity: 10 },
    { location_dong: '3동', location_line: '2호', quantity: 10 },
    { location_dong: '3동', location_line: '4호', quantity: 5 },
    { location_dong: '9동', location_line: '1호', quantity: 7 },
  ];

  it('포장 지시문이 있으면 그 단위로 후보를 만든다', () => {
    const candidates = buildPackagingCandidates(items, '3동(1,2호 포장, 4,5호 포장)');
    const labels = candidates.map(c => c.label);

    expect(labels).toContain('3동 1,2호');
    expect(labels).toContain('3동 4,5호');
    expect(candidates.find(c => c.label === '3동 1,2호')?.quantity).toBe(20);
    expect(candidates.find(c => c.label === '3동 1,2호')?.source).toBe('instruction');
  });

  it('지시문에 없는 동·호는 추론 후보로 따로 올린다', () => {
    const candidates = buildPackagingCandidates(items, '3동(1,2호 포장, 4,5호 포장)');
    const extra = candidates.find(c => c.dong === '9동');

    expect(extra?.label).toBe('9동 1호');
    expect(extra?.source).toBe('derived');
  });

  it('지시문이 없으면 동별로 묶어 후보를 만든다', () => {
    const candidates = buildPackagingCandidates(items, null);

    expect(candidates.map(c => c.label)).toEqual(['3동 1,2,4호', '9동 1호']);
    expect(candidates.every(c => c.source === 'derived')).toBe(true);
  });

  it('이미 만든 포장 단위는 created 로 표시한다', () => {
    const candidates = buildPackagingCandidates(items, '3동(1,2호 포장)', ['3동 1,2호']);
    expect(candidates.find(c => c.label === '3동 1,2호')?.created).toBe(true);
    expect(candidates.find(c => c.dong === '9동')?.created).toBe(false);
  });

  it('품목이 하나도 안 걸리는 후보는 내놓지 않는다', () => {
    const candidates = buildPackagingCandidates(items, '7동(1,2호 포장)');
    expect(candidates.some(c => c.dong === '7동')).toBe(false);
  });
});

/**
 * 여러 호를 한 줄로 합칠 때 실명 고르기.
 *
 * 합쳐진 줄은 그 호들의 창을 전부 담으므로 라벨도 전부를 가리켜야 한다.
 * 실물 ERP 9시트가 예외 없이 그랬다 (`__tests__/erp-upload.test.ts` 에서 136행 전수 대조).
 */
describe('pickRoom — 합친 호들의 실명', () => {
  it('하나뿐이면 그대로 쓴다', () => {
    expect(pickRoom(['거실F(外)'])).toEqual({ room: '거실F(外)', ambiguous: false });
  });

  it('빈 값만 있으면 빈 문자열', () => {
    expect(pickRoom([null, undefined, ''])).toEqual({ room: '', ambiguous: false });
  });

  it('포함 관계면 포괄하는 쪽을 쓴다 — 첫 값이 아니라', () => {
    // 1호 주방/식당 · 2호 주방/식당+드레스룸 · 3호 주방/식당 → 합치면 드레스룸도 들어간다
    expect(pickRoom(['주방/식당(外)', '주방/식당,드레스룸(外)', '주방/식당(外)'])).toEqual({
      room: '주방/식당,드레스룸(外)',
      ambiguous: false,
    });
  });

  it('순서가 뒤바뀌어도 결과가 같다', () => {
    expect(pickRoom(['드레스룸,팬트리(內)', '드레스룸(內)']).room).toBe('드레스룸,팬트리(內)');
    expect(pickRoom(['드레스룸(內)', '드레스룸,팬트리(內)']).room).toBe('드레스룸,팬트리(內)');
  });

  it('포함 관계가 아니면 고르지 않고 사람에게 넘긴다', () => {
    const picked = pickRoom(['거실F(外)', '침실1,2(外)']);
    expect(picked.ambiguous).toBe(true);
  });

  it('창구분(外/內)이 섞이면 판단하지 않는다', () => {
    expect(pickRoom(['주방/식당(外)', '주방/식당,드레스룸(內)']).ambiguous).toBe(true);
  });
});
