// @vitest-environment node
/**
 * 발주서 → ERP 업로드 엑셀 대조 테스트.
 *
 * 기준 자료: 발주서(우미건설-남원주 역세권1차) 7차 시트
 *          → ERP-2026년.xlsx 의 "우미 남원주7차" 계열 9시트 (사람이 손으로 만든 실물)
 *
 * 규격(가로·세로)과 수량은 발주서에서 기계적으로 결정되므로 전부 일치해야 한다.
 * 위치 문자열은 사람이 손으로 적은 칸이라 실물에 오타가 있다 — 아래 KNOWN_TYPOS 참고.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { parseOrderExcel } from '@/lib/parser/excel-order';
import { type WorkOrderSourceItem } from '@/lib/work-order/build';
import { buildErpUpload } from '@/lib/erp/upload-sheet';
import { detectPackaging } from '@/lib/erp/packaging-note';
import { hintsFromWorksheet } from '@/lib/erp/sheet-hints';
import { buildErpUploadWorkbook } from '@/lib/erp/upload-excel';

const ORDER_FILE = path.join(process.cwd(), '발주서(우미건설-남원주 역세권1차) (11).xlsx');
const ERP_FILE = path.join(process.cwd(), 'ERP-2026년.xlsx');
const hasFixture = fs.existsSync(ORDER_FILE) && fs.existsSync(ERP_FILE);

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

function readOrderSheet(sheetName: string) {
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
  return { rows, hints: hintsFromWorksheet(wb.Sheets[sheetName]) };
}

/** ERP 실물에서 "위치 | 가로 | 세로 | 수량" 을 읽는다. */
function readErpSheets() {
  const wb = XLSX.readFile(ERP_FILE);
  return wb.SheetNames.filter(n => n.includes('남원주7차')).map(name => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '' });
    return {
      name,
      rows: rows
        .slice(1)
        .filter(r => norm(r[0]))
        .map(r => ({ location: norm(r[0]), w: Number(r[1]), h: Number(r[2]), qty: Number(r[3]) })),
    };
  });
}

/**
 * ERP 실물의 수기 오타 — 발주서에는 올바른 값이 들어 있다.
 * 자동 생성하면 사라지는 차이라서 테스트에서 제외한다.
 */
const KNOWN_TYPOS: Record<string, string> = {
  // 층이 31~35F 인데 36F/38F 로 잘못 적힘
  '3동 1~3호 84A,B 31~36F 주방/식당,드레스룸(外)': '3동 1~3호 84A,B 31~35F 주방/식당,드레스룸(外)',
  '3동 1~3호 84A,B 31~36F 주방/식당,드레스룸(內)': '3동 1~3호 84A,B 31~35F 주방/식당,드레스룸(內)',
  '4동 2,3호 84A,B 31~38F발코니1': '4동 2,3호 84A,B 31~35F 발코니1',
  // 실명이 잘림
  '4동 1~3호 84A,B 31~35F 주방/식당,드레스(外)': '4동 1~3호 84A,B 31~35F 주방/식당,드레스룸(外)',
  '4동 1~3호 84A,B 31~35F 주방/식당,드레스(內)': '4동 1~3호 84A,B 31~35F 주방/식당,드레스룸(內)',
  // 띄어쓰기 누락
  '2동 3~5호 84A,B31~35F 거실F(外)': '2동 3~5호 84A,B 31~35F 거실F(外)',
  '2동 4,5호 84A,B 31~35F발코니1': '2동 4,5호 84A,B 31~35F 발코니1',
};

const fixTypo = (loc: string) => KNOWN_TYPOS[loc] ?? loc;

/** 화면과 완전히 같은 경로로 만든다 — 감지부터 조립까지. */
function buildFor(sheetName: string) {
  const { rows, hints } = readOrderSheet(sheetName);
  const found = detectPackaging(hints.topLines, hints.markerCells, rows);
  return buildErpUpload(rows, found.groups, found.source, found.dongOrder);
}

// 포장 단위 감지 자체는 __tests__/erp-packaging-detect.test.ts 에서 다룬다.
describe.skipIf(!hasFixture)('발주서 7차 → ERP 업로드 엑셀', () => {
  it('포장 지시문에서 시트 9장이 나오고, 순서가 실물 ERP 배치와 같다', () => {
    const build = buildFor('7차');
    expect(build.sheets).toHaveLength(9);

    // 실물 ERP 의 시트 물리적 배치 순서 (동순서 3-4-2-1-5)
    expect(build.sheets.map(s => s.packaging_label)).toEqual([
      '3동 1~3호', '3동 4,5호',
      '4동 1~3호', '4동 4,5호',
      '2동 1,2호', '2동 3~5호',
      '1동 1~3호', '1동 4,5호',
      '5동 1~3호',
    ]);

    const theirOrder = readErpSheets().map(a => a.rows[0].location.match(/^\d+동 [\d~,]+호/)?.[0]);
    expect(build.sheets.map(s => s.packaging_label)).toEqual(theirOrder);
  });

  it('포장에 못 들어간 품목이 없다', () => {
    const build = buildFor('7차');
    expect(build.unassigned).toEqual([]);
  });

  it('총 수량이 실물 ERP 9시트 합계와 같다', () => {
    const build = buildFor('7차');
    const theirTotal = readErpSheets()
      .flatMap(s => s.rows)
      .reduce((sum, r) => sum + r.qty, 0);

    // 480+330+340+480+480+330+480+340+480 = 3,740장
    expect(build.total_quantity).toBe(3740);
    expect(build.total_quantity).toBe(theirTotal);
  });

  it('실물 ERP 9시트와 행 수 · 규격 · 수량이 전부 일치한다', () => {
    const build = buildFor('7차');
    const actual = readErpSheets();

    let compared = 0;
    for (const sheet of build.sheets) {
      // 실물은 시트명이 "우미 남원주7차 (n)" 이라 위치 첫 칸으로 짝을 찾는다
      const match = actual.find(a => a.rows[0]?.location.startsWith(sheet.packaging_label));
      expect(match, `${sheet.packaging_label} 에 대응하는 ERP 시트`).toBeDefined();
      if (!match) continue;

      expect(sheet.rows.length, `${sheet.packaging_label} 행 수`).toBe(match.rows.length);

      const mine = sheet.rows.map(r => [r.width_mm, r.height_mm, r.quantity]);
      const theirs = match.rows.map(r => [r.w, r.h, r.qty]);
      expect(mine, `${sheet.packaging_label} 규격·수량`).toEqual(theirs);
      compared += sheet.rows.length;
    }

    expect(compared).toBe(136);
  });

  it('위치 문자열이 136행 전부 실물과 글자까지 같다 (실물 수기 오타 7건 보정 후)', () => {
    const build = buildFor('7차');
    const actual = readErpSheets();

    let compared = 0;
    for (const sheet of build.sheets) {
      const match = actual.find(a => a.rows[0]?.location.startsWith(sheet.packaging_label));
      if (!match) continue;

      for (const [i, row] of sheet.rows.entries()) {
        expect(row.location, `${sheet.packaging_label} ${i + 1}행`).toBe(fixTypo(match.rows[i].location));
        compared++;
      }
    }

    expect(compared).toBe(136);
  });

  /**
   * 합친 호들의 실명이 다를 때는 **포괄하는 쪽**을 쓴다.
   *
   * 3동 1~3호 455×950 이 그런 경우다 — 1·3호는 주방/식당 창만 10장씩인데
   * 2호는 드레스룸 창까지 있어 20장이라, 발주서 실명이
   * "주방/식당" 과 "주방/식당,드레스룸" 으로 갈린다.
   * 실물 ERP 9시트는 예외 없이 "주방/식당,드레스룸" 을 적었다 —
   * 합쳐진 줄이 두 방의 창을 모두 담으니 라벨도 둘 다 가리켜야 한다.
   *
   * (전에는 이걸 "자동 판정 불가" 로 두고 첫 값을 넣은 뒤 경고를 띄웠는데,
   *  실물 9시트를 전수 대조해 보니 규칙이 일관돼 있었다.)
   */
  it('합친 호들의 실명이 포함 관계면 포괄하는 쪽을 쓴다', () => {
    const build = buildFor('7차');
    const rows = build.sheets.flatMap(s => s.rows);

    const merged = rows.filter(r => r.location.includes('주방/식당,드레스룸'));
    expect(merged.length).toBeGreaterThan(0);
    // 3동 1~3호 455×950 은 40장 한 줄 (1호 10 + 2호 20 + 3호 10)
    const target = rows.find(
      r => r.location.startsWith('3동 1~3호') && r.width_mm === 455 && r.height_mm === 950,
    );
    expect(target?.location).toBe('3동 1~3호 84A,B 31~35F 주방/식당,드레스룸(外)');
    expect(target?.quantity).toBe(40);
  });

  it('포함 관계로 정리되는 행에는 더 이상 확인 요청을 띄우지 않는다', () => {
    const build = buildFor('7차');
    const flagged = build.sheets
      .flatMap(s => s.rows)
      .filter(r => r.review.some(v => v.includes('실명이 서로 다른데')));

    // 7차는 전부 포함 관계라 사람이 고를 일이 없다
    expect(flagged).toEqual([]);
  });

  it('엑셀로 쓰면 포장마다 시트 1장, 헤더가 위치/규/격/수량 이다', () => {
    const build = buildFor('7차');
    const wb = buildErpUploadWorkbook(build);

    expect(wb.SheetNames).toHaveLength(9);

    const first = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(first, { header: 1, defval: '' });
    expect(rows[0]).toEqual(['위치', '규', '격', '수량']);
    expect(rows).toHaveLength(build.sheets[0].rows.length + 1);
  });
});

describe.skipIf(!hasFixture)('학습되지 않은 양식 대응', () => {
  it('포장 지시문이 없으면 전체를 한 장으로 묶고 그 사실을 알린다', () => {
    const { rows } = readOrderSheet('7차');
    const build = buildErpUpload(rows, [], 'fallback-single');

    expect(build.sheets).toHaveLength(1);
    expect(build.sheets[0].source).toBe('fallback-single');
    expect(build.sheets[0].review.join(' ')).toContain('포장 단위를 찾지 못해');
    // 품목을 잃지 않는다
    expect(build.total_quantity).toBe(3740);
  });

  it('위치를 못 읽은 품목은 버리지 않고 미배정으로 보고한다', () => {
    const rows: WorkOrderSourceItem[] = [
      { product_name: 'X', width_mm: 100, height_mm: 200, quantity: 5,
        location_dong: '1동', location_line: '1호', location_floor: null, location_type: null, location_room: null },
      { product_name: 'X', width_mm: 100, height_mm: 200, quantity: 7,
        location_dong: null, location_line: null, location_floor: null, location_type: null, location_room: null },
    ];
    const build = buildErpUpload(rows, [{ dong: '1동', units: ['1호'], label: '1동 1호' }], 'instruction');

    expect(build.sheets).toHaveLength(1);
    expect(build.unassigned).toHaveLength(1);
    expect(build.unassigned[0].quantity).toBe(7);
    expect(build.review.join(' ')).toContain('어느 포장에도 들어가지 못한');
  });

  it('위치 조각이 비면 비운 채로 두고 확인 요청을 남긴다', () => {
    const rows: WorkOrderSourceItem[] = [
      { product_name: 'X', width_mm: 100, height_mm: 200, quantity: 5,
        location_dong: '1동', location_line: '1호', location_floor: null, location_type: null, location_room: null },
    ];
    const build = buildErpUpload(rows, [{ dong: '1동', units: ['1호'], label: '1동 1호' }], 'instruction');
    const row = build.sheets[0].rows[0];

    expect(row.location).toBe('1동 1호');           // 있는 조각만 이어 붙인다
    expect(row.review.join(' ')).toContain('타입·층·실명');
  });
});
