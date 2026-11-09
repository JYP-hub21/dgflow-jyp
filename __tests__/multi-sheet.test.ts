import { describe, expect, it } from 'vitest';
import { keyOf, keyerFor, keysText, mergeScans, splitKey } from '@/lib/erp/multi-sheet';
import type { OrderScan, ScanRow } from '@/lib/parser/order-scan';
import { rowsFromScan } from '@/lib/erp/from-scan';

const row = (excel_row: number, block_index: number, package_index: number, kind: ScanRow['kind'] = 'item'): ScanRow => ({
  excel_row, kind, product_name: 'P', spec_note: '', width_mm: 100, height_mm: 200, quantity: 2,
  location_text: '', location_raw: '', location_dong: '1동', location_line: '1호', location_floor: '', location_type: '', location_room: '',
  block_index, package_index, keep_source_order: false, notes: [],
});
const scan = (rows: ScanRow[], declared: number | null, note: string): OrderScan => ({
  header_row: 13, columns: {} as OrderScan['columns'], location_source: 'location-column', rows,
  blocks: [{ index: 0, product_name: 'P', spec_note: '', location_prefix: '', declared_quantity: 4, actual_quantity: 4, item_rows: 2, package_index: 0, keep_source_order: false }],
  packages: [{ index: 0, label: '', declared_quantity: null, actual_quantity: 4, block_indexes: [0] }],
  declared_total: declared, actual_total: rows.filter(r => r.kind === 'item').reduce((s, r) => s + r.quantity, 0), notes: [note],
});

describe('여러 차수 시트 합치기', () => {
  it('행 열쇠 — 시트가 하나면 엑셀 행 그대로, 여럿이면 시트 순서로 구분', () => {
    expect(keyOf(1, 0, 15)).toBe(15);
    expect(keyOf(2, 1, 15)).toBe(200015);
    expect(splitKey(200015)).toEqual({ index: 1, row: 15 });
    expect(splitKey(15)).toEqual({ index: 0, row: 15 });
    expect(keyerFor(['1차', '2차'])('2차', 7)).toBe(200007);
    expect(keyerFor(['1차', '2차'])('3차', 7)).toBeNull();
    expect(keyerFor(['7차'])('아무 이름', 7)).toBe(7);
    expect(keysText([100015, 100016, 200003], ['1차', '2차'])).toBe('1차 15-16 · 2차 3');
  });

  it('스캔 둘을 하나로 — 행 · 블록 · 포장 번호가 안 겹치고, 총계는 둘 다 있을 때만 더한다', () => {
    const a = scan([row(15, 0, 0), row(16, 0, 0)], 4, '앞 시트 메모');
    const b = scan([row(15, 0, 0), row(16, 0, 0)], null, '뒤 시트 메모');
    const m = mergeScans([{ name: '1차', scan: a }, { name: '2차', scan: b }]);
    expect(m.rows.map(r => [r.excel_row, r.block_index, r.package_index, r.sheet_name, r.sheet_row])).toEqual([
      [100015, 0, 0, '1차', 15], [100016, 0, 0, '1차', 16], [200015, 1, 1, '2차', 15], [200016, 1, 1, '2차', 16],
    ]);
    expect(m.blocks.map(x => x.index)).toEqual([0, 1]);
    expect(m.packages.map(x => [x.index, x.block_indexes])).toEqual([[0, [0]], [1, [1]]]);
    expect(m.declared_total).toBeNull();
    expect(m.actual_total).toBe(8);
    expect(m.notes).toEqual(['[1차] 앞 시트 메모', '[2차] 뒤 시트 메모']);
    // 화면에는 "2차 15행" 처럼 보인다
    expect(rowsFromScan(m).map(r => [r.source_row, r.source_label])).toEqual([
      [100015, '1차 15'], [100016, '1차 16'], [200015, '2차 15'], [200016, '2차 16'],
    ]);
    // 시트가 하나면 그대로
    expect(mergeScans([{ name: '7차', scan: a }])).toBe(a);
  });
});
