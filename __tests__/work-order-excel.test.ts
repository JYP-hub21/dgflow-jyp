import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { parseWorkOrderSheet, parseSpec } from '@/lib/work-order/excel';
import { verifyScan } from '@/lib/work-order/verify';

/**
 * ERP 가 내보낸 실물 작업의뢰서 엑셀(2286.xlsx)로 파서를 확인한다.
 * 같은 의뢰서의 인쇄본이 `KakaoTalk_20260826_100924916.png` 다.
 */

const FILE = path.join(process.cwd(), '2286.xlsx');
const HAS_FILE = fs.existsSync(FILE);

function sheetRows(file: string): unknown[][] {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
}

describe.skipIf(!HAS_FILE)('ERP 작업의뢰서 엑셀 읽기 — 2286.xlsx', () => {
  const parsed = HAS_FILE ? parseWorkOrderSheet(sheetRows(FILE)) : null;

  it('품목 13행을 읽는다', () => {
    expect(parsed!.items).toHaveLength(13);
    expect(parsed!.warnings).toEqual([]);
  });

  it('첫 행의 규격·수량·면적이 실물과 같다', () => {
    expect(parsed!.items[0]).toMatchObject({
      no: 1,
      product_name: '22T 5newGN+12AR.+5로이',
      width_mm: 1662,
      height_mm: 1975,
      quantity: 18,
      area_m2: 59.04,
    });
    expect(parsed!.items[0].remark).toContain('202동');
  });

  it('품명 병합 셀을 물려받는다', () => {
    const names = parsed!.items.map((i) => i.product_name);
    expect(names.slice(0, 6)).toEqual(Array(6).fill('22T 5newGN+12AR.+5로이'));
    expect(names.slice(6, 12)).toEqual(Array(6).fill('22T 5CL+12Ar.+5로이'));
    expect(names[12]).toBe('22T 5newGN+12A+5로이');
  });

  it('소계 3개와 합계를 품목과 섞지 않고 따로 담는다', () => {
    expect(parsed!.printed_subtotals).toEqual([
      { after_no: 6, quantity: 364, area_m2: 311.8 },
      { after_no: 12, quantity: 364, area_m2: 308.92 },
      { after_no: 13, quantity: 72, area_m2: 20.16 },
    ]);
    expect(parsed!.printed_total).toEqual({ quantity: 800, area_m2: 640.88 });
  });

  it('읽은 값이 의뢰서 자신의 소계·합계와 맞는다', () => {
    const check = verifyScan(parsed!);
    expect(check.ok).toBe(true);
    expect(check.total!.counted).toEqual({ quantity: 800, area_m2: 640.88 });
    // ERP 면적과 우리 계산(최소 3재)이 전 행에서 일치한다
    expect(check.row_warnings).toEqual([]);
  });
});

describe('규격 칸 읽기', () => {
  it('쉼표를 떼고 숫자 둘로 나눈다', () => {
    expect(parseSpec('1,662 X 1,975')).toEqual([1662, 1975]);
    expect(parseSpec('612 X 974')).toEqual([612, 974]);
  });

  it('구분자가 달라도 읽는다', () => {
    expect(parseSpec('455x950')).toEqual([455, 950]);
    expect(parseSpec('455 × 950')).toEqual([455, 950]);
    expect(parseSpec('455 * 950')).toEqual([455, 950]);
  });

  it('못 읽으면 null — 추측하지 않는다', () => {
    expect(parseSpec('1662')).toBeNull();
    expect(parseSpec('가로X세로')).toBeNull();
    expect(parseSpec('')).toBeNull();
    expect(parseSpec(null)).toBeNull();
  });
});

describe('표를 못 찾는 시트', () => {
  it('헤더가 없으면 품목 0건으로 두고 알린다', () => {
    const parsed = parseWorkOrderSheet([['아무 말'], [1, 2, 3]]);
    expect(parsed.items).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
  });

  it('열 순서가 바뀌어도 이름으로 찾는다', () => {
    const parsed = parseWorkOrderSheet([
      ['비고', '수량', 'No', '규격', '품명', '면적'],
      ['3동 거실', 15, 1, '1,719 X 1,820', '22T 로이', 46.95],
    ]);
    expect(parsed.items[0]).toMatchObject({
      no: 1, width_mm: 1719, height_mm: 1820, quantity: 15, area_m2: 46.95,
      product_name: '22T 로이', remark: '3동 거실',
    });
  });
});
