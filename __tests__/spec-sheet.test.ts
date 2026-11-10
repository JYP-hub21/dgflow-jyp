// @vitest-environment node
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSpecSheetWorkbook, specSheetBlocks, specSheetDate } from '@/lib/erp/spec-sheet';
import type { OrderScan, ScanRow } from '@/lib/parser/order-scan';
import type { ErpUploadBuild, ErpUploadRow } from '@/lib/erp/upload-sheet';

const row = (excel_row: number, w: number, h: number, q: number, block_index = 0): ScanRow => ({
  excel_row, kind: 'item', product_name: 'P', spec_note: '', width_mm: w, height_mm: h, quantity: q,
  location_text: `${excel_row}행`, location_raw: '', location_dong: '', location_line: '', location_floor: '', location_type: '', location_room: '',
  block_index, package_index: 0, keep_source_order: false, notes: [],
});
const scan: OrderScan = {
  header_row: 1, columns: {} as OrderScan['columns'], location_source: 'location-column',
  rows: [row(15, 303, 303, 2), row(16, 1000, 1000, 1), row(17, 500, 500, 4)],
  blocks: [{ index: 0, product_name: 'P', spec_note: '', location_prefix: '', declared_quantity: null, actual_quantity: 7, item_rows: 3, package_index: 0, keep_source_order: false }],
  packages: [], declared_total: null, actual_total: 7, notes: [],
};
const erp = (location: string, w: number, h: number, q: number, src: number[], product_name = 'P'): ErpUploadRow =>
  ({ location, width_mm: w, height_mm: h, quantity: q, product_name, merged_from: 1, source_rows: src, review: [] });
const build: ErpUploadBuild = {
  sheets: [{ sheet_name: '1', packaging_label: 'A', source: 'derived', rows: [erp('16행', 1000, 1000, 1, [16]), erp('15행', 303, 303, 2, [15])], total_quantity: 3, review: [] }],
  unassigned: [], review: [], total_quantity: 3,
};

describe('규격정리 덩어리 — 화면 미리보기와 엑셀이 같이 쓰는 계산', () => {
  it('덩어리 = 포장 × 품명 — 좌 = 그 줄이 나온 발주서 행(발주서 순서), 우 = ERP 순서, 포장에 없는 행은 미배정', () => {
    const [b, rest] = specSheetBlocks(scan, build, { P: '22T 사내품명' });
    expect([b.package_label, b.first_in_package, b.erp_name]).toEqual(['A', true, '22T 사내품명']);
    expect(b.left.map(r => r.location)).toEqual(['15행', '16행']);
    expect(b.right.map(r => r.location)).toEqual(['16행', '15행']);
    expect(b.left[0].sai).toBe(2); // 303×303 두 장 = 2재
    expect(b.right[0].m2).toBe(1);
    expect([b.left_qty, b.right_qty]).toEqual([3, 3]);
    expect(b.right_m2).toBeCloseTo(1 + 0.303 * 0.303 * 2, 6);
    expect([rest.package_label, rest.left.map(r => r.location), rest.right]).toEqual(['포장 미배정', ['17행'], []]);
  });

  it('같은 품명이 여러 포장에 나와도 오른쪽이 되풀이되지 않는다 (우미 7차 82,660장 사고)', () => {
    const two: ErpUploadBuild = {
      sheets: [
        { sheet_name: '1', packaging_label: 'A', source: 'derived', rows: [erp('15행', 303, 303, 2, [15])], total_quantity: 2, review: [] },
        { sheet_name: '2', packaging_label: 'B', source: 'derived', rows: [erp('16행', 1000, 1000, 1, [16]), erp('17행', 500, 500, 4, [17])], total_quantity: 5, review: [] },
      ],
      unassigned: [], review: [], total_quantity: 7,
    };
    const blocks = specSheetBlocks(scan, two);
    expect(blocks.map(b => [b.package_label, b.left_qty, b.right_qty])).toEqual([['A', 2, 2], ['B', 5, 5]]);
  });

  it('DG 프리즘이 뺀 행은 좌측에서도 빼서 좌우 합계를 맞춘다', () => {
    const [b] = specSheetBlocks(scan, build, {}, [17]);
    expect(b.erp_name).toBe('P');
    expect(b.left.map(r => r.location)).toEqual(['15행', '16행']);
    expect(b.left_qty).toBe(b.right_qty);
  });
});

/**
 * 엑셀 모양 — 실물 규격정리(우미 · KCC)와 같은 인쇄 설정 · 서식 · 수식 (2026-11-10 점검).
 * 예전 판은 서식이 없어 우미 7차가 A4 33쪽으로 찍히고 왼쪽(발주서)은 1쪽에만 나왔다.
 */
describe('규격정리 엑셀 — 실물 서식 그대로', () => {
  async function written(productNames: Record<string, string> = {}) {
    const made = await buildSpecSheetWorkbook(scan, build, productNames, [], {
      date: new Date(2026, 10, 10), customerName: '우미건설', siteName: '남원주 역세권 7차',
    });
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await made.xlsx.writeBuffer());
    return back.getWorksheet('규격정리')!;
  }

  it('A4 세로 · 너비 1쪽에 맞춤 · 가로 가운데 · 머리글에 거래처 · 현장, 바닥글에 쪽 번호', async () => {
    const ws = await written();
    expect(ws.pageSetup).toMatchObject({ paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true });
    expect(ws.headerFooter.oddHeader).toBe('&L우미건설&C남원주 역세권 7차');
    expect(ws.headerFooter.oddFooter).toContain('&P');
  });

  it('품명 머리글 — A 포장 이름 · B:D 품명 굵게 · E 날짜 · H:J 우측 품명은 =B행', async () => {
    const ws = await written();
    expect(ws.getCell('A1').value).toBe('A');
    expect(ws.getCell('B1').value).toBe('P');
    expect(ws.getCell('B1').font.bold).toBe(true);
    expect(ws.getCell('D1').isMerged && ws.getCell('D1').master.address).toBe('B1');
    expect(ws.getCell('J1').isMerged && ws.getCell('J1').master.address).toBe('H1');
    expect(ws.getCell('E1').value).toBe('26.11.10');
    expect(ws.getCell('H1').formula).toBe('B1');
    expect(ws.getCell('B1').border.top?.style).toBe('medium');
    // DG 프리즘이 사내 품명을 제안했으면 그 글자
    expect((await written({ P: '22T 사내품명' })).getCell('H1').value).toBe('22T 사내품명');
  });

  it('줄 — 평 · M2 는 실물 수식(값도 넣어 둠), 숫자 서식은 소수 2자리, 칸마다 가는 선 · 바깥은 굵은 선', async () => {
    const ws = await written();
    expect([ws.getCell('A2').value, ws.getCell('E2').value, ws.getCell('L2').value]).toEqual(['위치', '평', 'M2']);
    // 3행: 좌 = 발주서 15행(303×303×2), 우 = ERP 첫 줄(16행 1000×1000×1)
    expect([ws.getCell('A3').value, ws.getCell('B3').value, ws.getCell('D3').value]).toEqual(['15행', 303, 2]);
    expect(ws.getCell('E3').formula).toBe('SUM(B3*C3/91809*D3)');
    expect(ws.getCell('E3').result).toBe(2);
    expect(ws.getCell('K3').formula).toBe('SUM(H3*I3/91809*J3)');
    expect(ws.getCell('L3').formula).toBe('(H3/1000*I3/1000)*J3');
    expect(ws.getCell('L3').result).toBe(1);
    expect(ws.getCell('E3').numFmt).toContain('#,##0.00');
    expect(ws.getCell('L3').numFmt).toContain('#,##0.00');
    expect(ws.getCell('C3').border.left?.style).toBe('hair');
    expect(ws.getCell('A3').border.left?.style).toBe('medium');
    expect(ws.getCell('G3').border.left?.style).toBe('medium');
    expect(ws.getCell('L3').border.right?.style).toBe('medium');
    expect(ws.getCell('A3').font.size).toBe(8);
  });

  it('합계 — SUM 수식 · 이중선, 덩어리 사이 빈 줄 없이 다음 품명 머리글', async () => {
    const ws = await written();
    expect(ws.getCell('D5').formula).toBe('SUM(D3:D4)');
    expect(ws.getCell('D5').result).toBe(3);
    expect(ws.getCell('J5').formula).toBe('SUM(J3:J4)');
    expect(ws.getCell('L5').formula).toBe('SUM(L3:L4)');
    expect(ws.getCell('D5').border.top?.style).toBe('double');
    expect(ws.getCell('D5').border.bottom?.style).toBe('double');
    expect(ws.getCell('A6').value).toBe('포장 미배정');
  });

  it("날짜는 그 PC 날짜 'yy.mm.dd'", () => {
    expect(specSheetDate(new Date(2026, 0, 5, 0, 0))).toBe('26.01.05');
  });
});
