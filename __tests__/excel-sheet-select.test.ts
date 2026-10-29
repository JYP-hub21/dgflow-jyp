// @vitest-environment node
// xlsx 의 type:'array' 경로는 jsdom 에서 시트를 하나만 읽는다 (브라우저/node 에서는 정상).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseOrderExcel, listOrderSheets } from '@/lib/parser/excel-order';

// 차수별로 시트가 나뉜 실제 발주서 (1차~6차)
const MULTI_SHEET_FILE = path.join(
  process.cwd(),
  'data/1. 발주서 관련/1. 담당별 발주서 모음/안광식 상무님 발주서.xlsx'
);

function readBuffer(file: string): ArrayBuffer {
  const buf = fs.readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('발주서 시트 선택', () => {
  it('시트 목록과 행 수를 모두 반환한다', () => {
    const sheets = listOrderSheets(readBuffer(MULTI_SHEET_FILE));

    expect(sheets.length).toBeGreaterThan(1);
    const names = sheets.map(s => s.name);
    for (const cha of ['1차', '2차', '3차', '4차', '5차', '6차']) {
      expect(names).toContain(cha);
    }
    expect(sheets.every(s => s.rows >= 0)).toBe(true);
  });

  it('시트명을 지정하면 해당 시트를 파싱한다', () => {
    const buf = readBuffer(MULTI_SHEET_FILE);

    for (const cha of ['1차', '2차', '5차']) {
      const result = parseOrderExcel(buf, cha);
      expect(result.sheetName).toBe(cha);
      expect(result.items.length).toBeGreaterThan(0);
    }
  });

  it('시트명이 없으면 행이 가장 많은 시트를 고른다 (기존 동작)', () => {
    const buf = readBuffer(MULTI_SHEET_FILE);
    const sheets = listOrderSheets(buf);
    const maxRows = Math.max(...sheets.map(s => s.rows));

    const result = parseOrderExcel(buf);
    const picked = sheets.find(s => s.name === result.sheetName);

    expect(picked?.rows).toBe(maxRows);
  });

  it('없는 시트명을 주면 자동 선택으로 되돌아간다', () => {
    const buf = readBuffer(MULTI_SHEET_FILE);

    const fallback = parseOrderExcel(buf, '존재하지않는시트');
    const auto = parseOrderExcel(buf);

    expect(fallback.sheetName).toBe(auto.sheetName);
  });
});

// 날짜가 들어간 발주서 (발주일 셀이 Date 로 읽혀 "Wed Jun 11 2026..." 로 문자열화된다)
const DATE_HEADER_FILE = path.join(
  process.cwd(),
  'data/1. 발주서 관련/1. 담당별 발주서 모음/오동석 부장님 발주서.xlsx'
);

describe('헤더 행 탐색', () => {
  it('발주일 행을 헤더로 오인하지 않는다', () => {
    const buf = readBuffer(DATE_HEADER_FILE);

    // 이 시트들은 발주일이 날짜 서식이라 'W'(=가로) 부분 일치로 5행이 헤더로 잡혀 전부 0건이었다.
    for (const sheet of [
      '2026.06.11(본동 배면)',
      '2026.04.09(3,4차발주)',
      '2026.05.14(교육동C,B구간)',
      '2026.07.24(본동배면연결부)',
    ]) {
      const result = parseOrderExcel(buf, sheet);
      expect(result.items.length, `${sheet} 품목`).toBeGreaterThan(0);
      expect(result.warnings).not.toContain('유효한 품목 데이터가 없습니다. 가로/세로 값이 있는 행만 인식됩니다.');
    }
  });

  it('복구된 시트의 품목이 실제 값과 맞는다', () => {
    const result = parseOrderExcel(readBuffer(DATE_HEADER_FILE), '2026.06.11(본동 배면)');

    expect(result.items).toHaveLength(105);
    expect(result.meta.site_name).toContain('건강보험심사평가원');
    expect(result.items[0]).toMatchObject({
      product_name: '5MZT128 H/S + 14Ar(단열) + 5CL H/S',
      width_mm: '1162',
      height_mm: '1610',
      quantity: '1',
    });
    // "계" 같은 소계 행은 가로/세로가 숫자가 아니라 걸러진다
    expect(result.items.every(i => Number(i.width_mm) > 0 && Number(i.height_mm) > 0)).toBe(true);
  });

  it('헤더 없는 비발주 시트는 품목 0건으로 남는다', () => {
    const buf = readBuffer(MULTI_SHEET_FILE);
    for (const sheet of ['집계표', '골조도(일정)']) {
      expect(parseOrderExcel(buf, sheet).items).toHaveLength(0);
    }
  });
});

describe('메타 날짜 변환', () => {
  it('"2026년 06월 09일" 형태를 ISO 날짜로 바꾼다', () => {
    const result = parseOrderExcel(readBuffer(DATE_HEADER_FILE), '2026.06.11(본동 배면)');
    expect(result.meta.order_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.meta.delivery_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('아파트 발주서 위치 추출', () => {
  const UMI_FILE = path.join(process.cwd(), '발주서(우미건설-남원주 역세권1차) (11).xlsx');

  it.skipIf(!fs.existsSync(UMI_FILE))('동·호·타입·층·실명을 품목에 채운다', () => {
    const result = parseOrderExcel(readBuffer(UMI_FILE), '5차');
    const first = result.items[0];

    expect(first.location_dong).toBe('1동');
    expect(first.location_line).toBe('1호');
    expect(first.location_type).toBe('84A'); // 블록 다음 줄에 있는 값을 끌어와야 한다
    expect(first.location_floor).toBe('21~25F');
    expect(first.location_room).toBe('드레스룸,팬트리(外)');

    // 모든 품목이 동·호를 가진다
    expect(result.items.every(i => i.location_dong && i.location_line)).toBe(true);
  });

  it.skipIf(!fs.existsSync(UMI_FILE))('수량 0인 "발주 없음" 행은 품목으로 만들지 않는다', () => {
    const result = parseOrderExcel(readBuffer(UMI_FILE), '5차');

    expect(result.items.every(i => Number(i.quantity) > 0)).toBe(true);
    // 3동 3호에는 705×1820 발코니1 이 수량 0으로 적혀 있다
    const ghost = result.items.find(
      i => i.location_dong === '3동' && i.location_line === '3호' && i.width_mm === '705'
    );
    expect(ghost).toBeUndefined();
  });

  it('수량 0 행을 버려도 품명 병합 상속은 끊기지 않는다', () => {
    const buf = readBuffer(MULTI_SHEET_FILE);
    // 안광식 5차는 205행이 수량 0 (발주 없음) — 189건만 남아야 한다
    expect(parseOrderExcel(buf, '5차').items).toHaveLength(189);
    expect(parseOrderExcel(buf, '1차').items).toHaveLength(388);
  });
});
