/**
 * 어떤 발주서든 같은 그릇(OrderLine[])에 담는다.
 *
 *   1 우미(=KCC) 양식   구조화된 동호·실명·타입층 열이 있음 → 가장 정확
 *   2 사내 양식         시트 = 타입·라인, 품명은 여러 줄, 소계로 블록 끝
 *   3 범용             품명/가로/세로/수량 머리를 찾아 읽고, 위치는 문장에서 뽑는다
 *
 * 범용 양식은 위치가 "9동" 처럼 구역 제목 줄에만 있고 품목 줄엔 비어 있는 경우가 많아
 * 빈 위치는 위 줄의 위치를 이어받는다.
 */
import * as XLSX from 'xlsx';
import type { OrderLine, UnitKind } from '@/lib/spec/organize';
import { parseLocation } from '@/lib/spec/location';
import { listWoomiSheets, parseWoomiOrder, type WoomiHeader } from './woomi-order';
import { listDongilSheets, parseDongilOrder } from './dongil-order';
import { listOrderSheets, parseOrderExcel } from './excel-order';

export type OrderFormat = 'woomi' | 'dongil' | 'generic';

export const FORMAT_LABEL: Record<OrderFormat, string> = {
  woomi: '우미·KCC 양식', dongil: '동일유리 사내 양식', generic: '일반 엑셀 (열 자동 인식)',
};

export interface SheetChoice {
  name: string;
  lines: number;
  note?: string;        // 사내 양식의 "내용" 칸 등
}

export interface DetectedOrder {
  format: OrderFormat;
  sheets: SheetChoice[];              // 읽을 수 있는 시트들
  defaultSheets: string[];            // 처음에 골라 둘 시트
  multiSelect: boolean;               // 여러 장을 함께 읽는 양식인지
}

export interface ReadOrder {
  format: OrderFormat;
  header: { site: string; orderNo: string; orderDate: string; dueDate: string; note: string };
  lines: OrderLine[];
  /** 통일 양식(2)의 포장묶음 칸에서 읽은 묶음 제안 — 없으면 빈 배열 */
  packingHint: { dong: number; groups: number[][] }[];
  shipOrder: string;
  suggestedKind: UnitKind;
}

export function detectOrder(buffer: ArrayBuffer | Uint8Array): DetectedOrder {
  const woomi = listWoomiSheets(buffer).filter(s => s.lines > 0);
  if (woomi.length) {
    const rec = woomi.find(s => s.recommended) ?? woomi[0];
    return { format: 'woomi', sheets: woomi.map(s => ({ name: s.name, lines: s.lines })), defaultSheets: [rec.name], multiSelect: false };
  }
  const dongil = listDongilSheets(buffer).filter(s => s.lines > 0);
  if (dongil.length) {
    return { format: 'dongil', sheets: dongil.map(s => ({ name: s.name, lines: s.lines, note: s.content })), defaultSheets: dongil.map(s => s.name), multiSelect: true };
  }
  const gen = listOrderSheets(buffer).filter(s => s.items > 0);
  const rec = gen.find(s => s.recommended) ?? gen[0];
  return { format: 'generic', sheets: gen.map(s => ({ name: s.name, lines: s.items })), defaultSheets: rec ? [rec.name] : [], multiSelect: true };
}

/** 통일 양식(2)의 포장묶음 칸 — 13~14행: 1동[C:D] 2동[F:G] 3동[I:J] / 4동 5동 6동 */
function readPackingCells(ws: XLSX.WorkSheet): { hint: ReadOrder['packingHint']; shipOrder: string } {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false, range: 'A11:J14', blankrows: true });
  const str = (v: unknown) => String(v ?? '').trim();
  const hint: ReadOrder['packingHint'] = [];
  const r12 = rows[1] ?? [], r13 = rows[2] ?? [], r14 = rows[3] ?? [];
  if (!/출고순서/.test(str(r12[0])) || !/포장묶음/.test(str(r13[0]))) return { hint, shipOrder: '' };
  const shipOrder = r12.slice(1).map(str).find(Boolean) ?? '';
  const cells: [unknown[], number, number][] = [[r13, 1, 2], [r13, 4, 5], [r13, 7, 8], [r14, 1, 2], [r14, 4, 5], [r14, 7, 8]];
  for (const [row, li, vi] of cells) {
    const dong = parseInt(str(row[li]), 10);
    const text = str(row[vi]) || str(row[vi + 1]);
    if (!Number.isFinite(dong) || !text) continue;
    const groups = text.split('/').map(g => g.split(/[,、\s]+/).map(x => parseInt(x, 10)).filter(n => Number.isFinite(n))).filter(g => g.length);
    if (groups.length) hint.push({ dong, groups });
  }
  return { hint, shipOrder };
}

function pickKind(lines: OrderLine[], format: OrderFormat): UnitKind {
  if (format === 'dongil') return 'sheet';
  const has = (f: (l: OrderLine) => boolean) => lines.some(f);
  if (has(l => l.dong !== undefined && l.ho !== undefined)) return 'dong-ho';
  if (has(l => l.dong !== undefined && l.line !== undefined)) return 'dong-line';
  if (has(l => l.dong !== undefined)) return 'dong';
  if (has(l => !!l.floor)) return 'floor';
  if (has(l => !!l.zone)) return 'zone';
  if (new Set(lines.map(l => l.sheet)).size > 1) return 'sheet';
  return 'all';
}

export function readOrder(buffer: ArrayBuffer | Uint8Array, format: OrderFormat, sheets: string[]): ReadOrder {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

  if (format === 'woomi') {
    const { header, lines } = parseWoomiOrder(buffer, sheets[0]);
    const ws = wb.Sheets[sheets[0]];
    const { hint, shipOrder } = readPackingCells(ws);
    return {
      format, lines: lines.map(l => ({ ...l, sheet: sheets[0] })),
      header: toHeader(header), packingHint: hint, shipOrder, suggestedKind: pickKind(lines, format),
    };
  }

  if (format === 'dongil') {
    const { header, lines } = parseDongilOrder(buffer, sheets);
    return {
      format, lines,
      header: { site: header.site, orderNo: header.orderNo, orderDate: '', dueDate: header.dueDate, note: header.content },
      packingHint: [], shipOrder: header.shipOrder, suggestedKind: pickKind(lines, format),
    };
  }

  // 범용
  const parsed = parseOrderExcel(buffer, { sheets });
  const lines: OrderLine[] = [];
  let carry = '';                                  // 구역 제목 줄의 위치를 아래 줄로 이어받기
  let row = 0;
  for (const it of parsed.items) {
    row++;
    const locText = [it.location_dong, it.location_line, it.location_floor, it.location_room, it.location_type, it.location_window_type]
      .filter(Boolean).join(' ').trim();
    if (locText) carry = locText;
    const w = parseFloat(String(it.width_mm).replace(/,/g, '')) || 0;
    const h = parseFloat(String(it.height_mm).replace(/,/g, '')) || 0;
    const qty = parseFloat(String(it.quantity).replace(/,/g, '')) || 0;
    if (!w || !h || !qty) continue;
    const loc = parseLocation(carry);
    lines.push({
      row, sheet: parsed.sheetName, product: it.product_name || '(품명 없음)', w, h, qty, rawLoc: carry,
      dong: loc.dong, ho: loc.ho?.[0], line: loc.line?.[0], floor: loc.floor, type: loc.type, zone: loc.zone,
      room: loc.rest || undefined,
    });
  }
  return {
    format, lines,
    header: { site: parsed.meta.site_name, orderNo: '', orderDate: parsed.meta.order_date, dueDate: parsed.meta.delivery_date, note: parsed.meta.remark },
    packingHint: [], shipOrder: '', suggestedKind: pickKind(lines, format),
  };
}

function toHeader(h: WoomiHeader) {
  return { site: h.site, orderNo: h.orderNo, orderDate: h.orderDate, dueDate: h.dueDate, note: h.note };
}
