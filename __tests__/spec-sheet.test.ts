import { describe, expect, it } from 'vitest';
import { specSheetBlocks } from '@/lib/erp/spec-sheet';
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
