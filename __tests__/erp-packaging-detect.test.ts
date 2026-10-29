// @vitest-environment node
/**
 * 포장 단위 감지 테스트.
 *
 * 이 테스트가 없어서 버그를 놓쳤다 — erp-upload.test.ts 는 포장 지시문을 A12 로
 * 행 번호를 직접 지정해 읽었는데, 화면은 "포장 이 들어간 첫 줄" 을 찾는 방식이었다.
 * 실제 발주서는 11행이 "※ 7차 주문서별 포장요망 (동순서 3-4-2-1-5)" 이고
 * 포장 단위는 12행에 있어서, 화면에서는 항상 전체가 한 장으로 떨어졌다.
 *
 * 그래서 여기서는 **화면이 쓰는 함수(collectSheetHints → detectPackaging)를 그대로** 호출한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { hintsFromWorksheet } from '@/lib/erp/sheet-hints';
import { detectPackaging, groupsByDongPublic, groupsByUnit } from '@/lib/erp/packaging-note';
import { parseOrderExcel } from '@/lib/parser/excel-order';
import type { WorkOrderSourceItem } from '@/lib/work-order/build';

const ORDER_FILE = path.join(process.cwd(), '발주서(우미건설-남원주 역세권1차) (11).xlsx');
const hasFixture = fs.existsSync(ORDER_FILE);

function detectFor(sheetName: string) {
  const buf = fs.readFileSync(ORDER_FILE);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  const parsed = parseOrderExcel(ab, sheetName);
  const rows: WorkOrderSourceItem[] = parsed.items.map(i => ({
    product_name: i.product_name,
    width_mm: Number(i.width_mm),
    height_mm: Number(i.height_mm),
    quantity: Number(i.quantity),
    location_dong: i.location_dong || null,
    location_line: i.location_line || null,
    location_floor: i.location_floor || null,
    location_type: i.location_type || null,
    location_room: i.location_room || null,
  }));

  const wb = XLSX.readFile(ORDER_FILE);
  const hints = hintsFromWorksheet(wb.Sheets[sheetName]);
  return { detection: detectPackaging(hints.topLines, hints.markerCells, rows), rows };
}

describe.skipIf(!hasFixture)('포장 단위 감지 — 화면과 같은 경로', () => {
  /** 회귀 방지: 11행의 "포장요망" 에 걸려 전체 한 장으로 떨어지면 안 된다. */
  it.each(['3차', '4차', '5차', '6차', '7차', '8차'])('%s 는 포장 9개로 나뉜다', sheetName => {
    const { detection } = detectFor(sheetName);

    expect(detection.groups).toHaveLength(9);
    expect(detection.source).toBe('instruction');
    expect(detection.groups.map(g => g.label)).toEqual([
      '1동 1~3호', '1동 4,5호',
      '2동 1,2호', '2동 3~5호',
      '3동 1~3호', '3동 4,5호',
      '4동 1~3호', '4동 4,5호',
      '5동 1~3호',
    ]);
  });

  it('7차의 동순서를 같은 경로에서 읽는다', () => {
    const { detection } = detectFor('7차');
    expect(detection.dongOrder).toEqual(['3동', '4동', '2동', '1동', '5동']);
  });

  it('근거 원문을 화면에 보여 줄 수 있게 담는다', () => {
    const { detection } = detectFor('7차');
    expect(detection.evidence).toContain('같이 포장');
  });

  /**
   * 1차·2차에는 포장 단위 문장도, "같이 포장" 표시행도 없다.
   * ("※ 동별,라인별 포장요망 ( 동순서 3-4-1-2-5 )" 뿐이다)
   * 이때는 전체를 한 장으로 두지 않고 동별로 나누되, 추론이라고 알린다.
   */
  it.each(['1차', '2차'])('%s 는 포장 단위 문장이 없어 동별로 추론한다', sheetName => {
    const { detection } = detectFor(sheetName);

    expect(detection.source).toBe('derived');
    expect(detection.groups.length).toBeGreaterThan(1);
    expect(detection.groups.every(g => /^\d+동 /.test(g.label))).toBe(true);
    expect(detection.notes.join(' ')).toContain('동별로 나눴습니다');
    // 발주서에 적힌 문구를 그대로 보여 준다
    expect(detection.notes.join(' ')).toContain('포장요망');
  });
});

describe.skipIf(!hasFixture)('사람이 고르는 분리 방식', () => {
  it('동별로 나누면 5장', () => {
    const { rows } = detectFor('7차');
    expect(groupsByDongPublic(rows).map(g => g.label)).toEqual([
      '1동 1~5호', '2동 1~5호', '3동 1~5호', '4동 1~5호', '5동 1~3호',
    ]);
  });

  it('동·호별로 나누면 세대 수만큼', () => {
    const { rows } = detectFor('7차');
    const groups = groupsByUnit(rows);
    // 1~4동 5호 + 5동 3호 = 23세대
    expect(groups).toHaveLength(23);
    expect(groups[0].label).toBe('1동 1호');
    expect(groups.at(-1)!.label).toBe('5동 3호');
  });
});

describe('표시행 파싱', () => {
  it('"같이 포장" 표시행에서 동·호를 읽는다 (띄어쓰기 없어도)', () => {
    const markers = [
      '1동 1,2,3호 같이 포장',
      '2동 3,4,5호 같이포장',
      '5동 1,2,3호 같이 포장',
    ];
    const d = detectPackaging([], markers, []);
    expect(d.groups.map(g => g.label)).toEqual(['1동 1~3호', '2동 3~5호', '5동 1~3호']);
  });

  it('물결 표기도 펼친다', () => {
    const d = detectPackaging([], ['3동 1~3호 같이 포장'], []);
    expect(d.groups[0].units).toEqual(['1호', '2호', '3호']);
  });

  it('근거가 전혀 없고 동·호도 없으면 한 장으로 두고 그 사실을 알린다', () => {
    const d = detectPackaging(['※ 현장시공'], [], []);
    expect(d.groups).toEqual([]);
    expect(d.source).toBe('fallback-single');
    expect(d.notes.join(' ')).toContain('전체를 한 장으로');
  });

  it('지시문이 두 줄에 걸쳐 있어도 찾는다', () => {
    const lines = ['※ 주문서별 포장요망', '1,3동( 1,2,3호 포장, 4,5호 포장)'];
    const d = detectPackaging(lines, [], []);
    expect(d.groups.map(g => g.label)).toEqual(['1동 1~3호', '1동 4,5호', '3동 1~3호', '3동 4,5호']);
  });
});
