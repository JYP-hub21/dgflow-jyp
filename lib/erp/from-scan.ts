/**
 * 발주서 구조 스캔 → ERP 빌드 입력
 *
 * `lib/parser/order-scan.ts` 가 읽어낸 구조를 ERP 생성기가 쓰는 모양으로 옮긴다.
 * 여기서 새로 판단하는 것은 없다 — 스캔 결과를 그대로 넘기기만 한다.
 */
import type { PackagingGroup, WorkOrderSourceItem } from '@/lib/work-order/build';
import type { OrderScan } from '@/lib/parser/order-scan';

/** 품목 행만 골라 ERP 생성기가 쓰는 모양으로 바꾼다. */
export function rowsFromScan(scan: OrderScan): WorkOrderSourceItem[] {
  return scan.rows
    .filter(r => r.kind === 'item')
    .map(r => ({
      product_name: r.product_name,
      width_mm: r.width_mm,
      height_mm: r.height_mm,
      quantity: r.quantity,
      location_dong: r.location_dong || null,
      location_line: r.location_line || null,
      location_floor: r.location_floor || null,
      location_type: r.location_type || null,
      location_room: r.location_room || null,
      location_text: r.location_text || null,
      source_row: r.excel_row,
      keep_source_order: r.keep_source_order,
    }));
}

/**
 * 소계 행으로 나뉜 포장 단위를 돌려준다.
 *
 * 발주서가 포장을 실제로 끊어 줬을 때만 쓴다. 판단 기준은 두 가지다.
 *  - 소계 행이 2개 이상 → 확실히 나눠 달라는 뜻
 *  - 소계 행이 1개인데 수량이 적혀 있음 → 한 포장임을 명시한 것
 *
 * 둘 다 아니면 빈 배열을 돌려주고, 호출 측이 동·호 기반 감지로 넘어간다.
 * (우미 발주서는 소계 행이 없고 상단 지시문이 포장을 지정한다)
 */
export function packagesFromScan(scan: OrderScan): PackagingGroup[] {
  const usable =
    scan.packages.length >= 2 ||
    (scan.packages.length === 1 && scan.packages[0].declared_quantity !== null);
  if (!usable) return [];

  const rowsByPackage = new Map<number, number[]>();
  for (const row of scan.rows) {
    if (row.kind !== 'item') continue;
    const list = rowsByPackage.get(row.package_index) ?? [];
    list.push(row.excel_row);
    rowsByPackage.set(row.package_index, list);
  }

  // scan.packages 는 빈 포장을 걸러내며 index 를 다시 매기므로,
  // 행이 들고 있는 원래 package_index 순서대로 묶어 준다.
  const orderedKeys = [...rowsByPackage.keys()].sort((a, b) => a - b);

  return orderedKeys.map((key, i) => {
    const pkg = scan.packages[i];
    const label = pkg?.label?.trim() || (orderedKeys.length > 1 ? `포장 ${i + 1}` : '전체');
    return {
      dong: '',
      units: [],
      label,
      row_keys: rowsByPackage.get(key) ?? [],
    };
  });
}

/** 포장 근거를 사람이 읽을 문장으로 — 화면에 그대로 보여 준다. */
export function packagingEvidenceFromScan(scan: OrderScan): string {
  if (scan.packages.length === 0) return '';
  const labels = scan.packages.map((p, i) => {
    const name = p.label?.trim() || `포장 ${i + 1}`;
    return p.declared_quantity !== null ? `${name} ${p.declared_quantity}장` : name;
  });
  return `발주서 합계 행 ${scan.packages.length}개 — ${labels.join(' / ')}`;
}
