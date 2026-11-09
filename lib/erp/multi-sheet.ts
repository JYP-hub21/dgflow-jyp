/**
 * 여러 차수 시트를 한 번에 — 2026-11-09 사용자 "1차와 2차 한번에 합쳐서 규격정리하자".
 *
 * 시트마다 따로 스캔한 뒤 하나의 스캔으로 합친다. 합친 스캔도 보통 스캔과 똑같이 생겨서
 * 아래 단계(포장 · ERP 시트 · 검산 · 규격정리)는 고치지 않고 그대로 쓴다.
 *
 * 행 번호가 시트마다 겹치므로 **행 열쇠**를 쓴다: 시트가 하나면 엑셀 행 번호 그대로,
 * 여럿이면 (시트 순서 + 1) × 100000 + 엑셀 행. 화면에는 "2차 15행" 처럼 보여 준다.
 */
import type { OrderScan, ScanRow } from '@/lib/parser/order-scan';

export const ROW_BASE = 100000;

/** 시트 순서(0부터) · 엑셀 행 → 행 열쇠 */
export function keyOf(sheetCount: number, sheetIndex: number, row: number): number {
  return sheetCount > 1 ? (sheetIndex + 1) * ROW_BASE + row : row;
}

/** 행 열쇠 → 시트 순서 · 엑셀 행 */
export function splitKey(key: number): { index: number; row: number } {
  return key >= ROW_BASE ? { index: Math.floor(key / ROW_BASE) - 1, row: key % ROW_BASE } : { index: 0, row: key };
}

/** 시트 이름 → 행 열쇠 만들기 (AI 답의 {sheet, row} 를 열쇠로 바꿀 때) */
export function keyerFor(sheetNames: string[]): (sheet: string, row: number) => number | null {
  const at = new Map(sheetNames.map((n, i) => [n.trim(), i]));
  return (sheet, row) => {
    const i = sheetNames.length === 1 ? 0 : at.get(String(sheet ?? '').trim());
    return i === undefined ? null : keyOf(sheetNames.length, i, row);
  };
}

/** 열쇠 묶음을 "15-20, 24" (시트 하나) 또는 "1차 15-20 · 2차 3-9" (여럿) 으로 */
export function keysText(keys: number[], sheetNames: string[]): string {
  const bySheet = new Map<number, number[]>();
  for (const k of keys) {
    const { index, row } = splitKey(k);
    bySheet.set(index, [...(bySheet.get(index) ?? []), row]);
  }
  const parts = [...bySheet.entries()].sort((a, b) => a[0] - b[0]).map(([i, rows]) => {
    const text = rangesOf(rows);
    return sheetNames.length > 1 ? `${sheetNames[i] ?? `시트${i + 1}`} ${text}` : text;
  });
  return parts.join(' · ');
}

function rangesOf(rows: number[]): string {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    out.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
  }
  return out.join(', ');
}

/**
 * 시트별 스캔을 하나로 합친다. 시트가 하나면 그대로 돌려준다.
 * 블록 · 포장 번호는 겹치지 않게 밀고, 총계는 모든 시트에 적혀 있을 때만 더한다.
 */
export function mergeScans(parts: { name: string; scan: OrderScan }[]): OrderScan {
  if (parts.length === 1) return parts[0].scan;
  const rows: ScanRow[] = [];
  const blocks: OrderScan['blocks'] = [];
  const packages: OrderScan['packages'] = [];
  const notes: string[] = [];
  let blockBase = 0;
  let packageBase = 0;
  parts.forEach(({ name, scan }, i) => {
    const maxBlock = Math.max(-1, ...scan.rows.map(r => r.block_index), ...scan.blocks.map(b => b.index));
    const maxPackage = Math.max(-1, ...scan.rows.map(r => r.package_index), ...scan.packages.map(p => p.index));
    for (const r of scan.rows) {
      rows.push({
        ...r,
        excel_row: keyOf(parts.length, i, r.excel_row),
        block_index: r.block_index + blockBase,
        package_index: r.package_index + packageBase,
        sheet_name: name,
        sheet_row: r.excel_row,
      });
    }
    for (const b of scan.blocks) blocks.push({ ...b, index: b.index + blockBase, package_index: b.package_index + packageBase });
    for (const p of scan.packages) {
      packages.push({ ...p, index: p.index + packageBase, block_indexes: p.block_indexes.map(x => x + blockBase) });
    }
    for (const n of scan.notes) notes.push(`[${name}] ${n}`);
    blockBase += maxBlock + 1;
    packageBase += maxPackage + 1;
  });
  const declared = parts.every(p => p.scan.declared_total !== null)
    ? parts.reduce((s, p) => s + (p.scan.declared_total ?? 0), 0)
    : null;
  const first = parts[0].scan;
  return {
    header_row: first.header_row,
    columns: first.columns,
    location_source: parts.every(p => p.scan.location_source === first.location_source) ? first.location_source : 'both',
    rows,
    blocks,
    packages,
    declared_total: declared,
    actual_total: parts.reduce((s, p) => s + p.scan.actual_total, 0),
    notes,
  };
}
