/**
 * 바이투 ERP 작업의뢰서 엑셀 파서
 *
 * 바이투 시트 27열 (A~AA):
 * A:주문번호 B:구분 C:품명 D:두께 E:규격단위 F:가로규격 G:세로규격
 * H:수량 I:미의뢰 J:의뢰수량 K:면적 L:거래처 M:현장명 N:주문비고
 * O:기타규격 P:비고 Q~Y:원산지/공정 Z:의뢰번호 AA:NO
 */
import * as XLSX from 'xlsx';

export interface ParsedWorkOrderItem {
  product_name: string;
  thickness: number | null;
  width_mm: number;
  height_mm: number;
  quantity: number;
  remark: string;
  sort_order: number;
}

export interface ParsedWorkOrder {
  work_order_number: string;  // 의뢰번호 (Z열)
  customer_name: string;      // 거래처 (L열)
  site_name: string;          // 현장명 (M열)
  items: ParsedWorkOrderItem[];
}

export interface ParseResult {
  workOrders: ParsedWorkOrder[];
  totalRows: number;
  errors: string[];
}

// 헤더 컬럼 매핑 (인덱스 기반)
const COL = {
  ORDER_NUMBER: 0,   // A: 주문번호
  PRODUCT_NAME: 2,   // C: 품명
  THICKNESS: 3,      // D: 두께
  WIDTH: 5,          // F: 가로규격
  HEIGHT: 6,         // G: 세로규격
  REQUEST_QTY: 9,    // J: 의뢰수량
  CUSTOMER: 11,      // L: 거래처
  SITE: 12,          // M: 현장명
  REMARK: 13,        // N: 주문비고
  WO_NUMBER: 25,     // Z: 의뢰번호
  NO: 26,            // AA: NO (생산순서)
} as const;

function findHeaderRow(data: unknown[][]): number {
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    const row = data[i];
    if (!row) continue;
    const first = String(row[0] || '').trim();
    const third = String(row[2] || '').trim();
    if (first === '주문번호' && third === '품명') return i;
  }
  return 0; // 기본: 첫 행이 헤더
}

function toNumber(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

export function parseWorkOrderExcel(buffer: ArrayBuffer | Buffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const errors: string[] = [];

  // '바이투' 시트 우선, 없으면 첫 번째 시트
  const sheetName = wb.SheetNames.includes('바이투')
    ? '바이투'
    : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return { workOrders: [], totalRows: 0, errors: ['시트를 찾을 수 없습니다.'] };
  }

  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  const headerIdx = findHeaderRow(data);
  const dataRows = data.slice(headerIdx + 1).filter(row =>
    row && String(row[COL.WO_NUMBER] || '').trim() !== ''
  );

  if (dataRows.length === 0) {
    return { workOrders: [], totalRows: 0, errors: ['데이터 행이 없습니다. 의뢰번호(Z열)를 확인해주세요.'] };
  }

  // 의뢰번호별 그룹핑
  const groupMap = new Map<string, { customer: string; site: string; items: ParsedWorkOrderItem[] }>();

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] as unknown[];
    const woNumber = String(row[COL.WO_NUMBER] || '').trim();
    if (!woNumber) continue;

    const productName = String(row[COL.PRODUCT_NAME] || '').trim();
    const width = toNumber(row[COL.WIDTH]);
    const height = toNumber(row[COL.HEIGHT]);
    const quantity = toNumber(row[COL.REQUEST_QTY]);
    const thickness = toNumber(row[COL.THICKNESS]) || null;
    const remark = String(row[COL.REMARK] || '').trim();
    const sortOrder = toNumber(row[COL.NO]) || (i + 1);
    const customer = String(row[COL.CUSTOMER] || '').trim();
    const site = String(row[COL.SITE] || '').trim();

    if (!productName) {
      errors.push(`행 ${headerIdx + 2 + i}: 품명이 비어있습니다 (의뢰번호: ${woNumber})`);
      continue;
    }
    if (width <= 0 || height <= 0) {
      errors.push(`행 ${headerIdx + 2 + i}: 가로/세로 규격이 올바르지 않습니다 (${productName})`);
      continue;
    }
    if (quantity <= 0) {
      errors.push(`행 ${headerIdx + 2 + i}: 의뢰수량이 0입니다 (${productName})`);
      continue;
    }

    if (!groupMap.has(woNumber)) {
      groupMap.set(woNumber, { customer, site, items: [] });
    }
    const group = groupMap.get(woNumber)!;
    // 거래처/현장명: 첫 행 값 사용 (같은 의뢰번호 내에서 동일해야 함)
    if (!group.customer && customer) group.customer = customer;
    if (!group.site && site) group.site = site;

    group.items.push({
      product_name: productName,
      thickness,
      width_mm: Math.round(width),
      height_mm: Math.round(height),
      quantity: Math.round(quantity),
      remark,
      sort_order: sortOrder,
    });
  }

  // Map → 배열 변환
  const workOrders: ParsedWorkOrder[] = [];
  for (const [woNumber, group] of groupMap) {
    // sort_order 기준 정렬
    group.items.sort((a, b) => a.sort_order - b.sort_order);
    workOrders.push({
      work_order_number: woNumber,
      customer_name: group.customer,
      site_name: group.site,
      items: group.items,
    });
  }

  // 의뢰번호 기준 정렬
  workOrders.sort((a, b) => a.work_order_number.localeCompare(b.work_order_number));

  return {
    workOrders,
    totalRows: dataRows.length,
    errors,
  };
}
