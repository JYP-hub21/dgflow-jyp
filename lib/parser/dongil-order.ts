/**
 * 동일유리 사내 발주서 양식 파서 (빈양식.xlsx 와 같은 155행 틀).
 *
 *   3행  주문서 NO · 주문서 발송일
 *   5행  현장명(C) · 내용(G) "59A타입(1동 1라인) 21~24층"
 *   7행  묶음번호(H) · 출고순서(J)   ← 새 양식에만
 *   8행  NO | 주 문 내 역 | ㎡ | 실란트 | 위치 | 비고
 *   9행  외판/내판 | 두께 | 가로 | 세로 | 단위 | 수량 | 개소 | 합계
 *   10행~ 블록: 품명이 B열에 여러 줄(그린로이 복층유리 / 5GN+12A+5로이 / 일반간봉…)로 적히고
 *          그 옆 E·F·H·I·J 가 규격 줄. '소 계' 행에서 블록이 끝난다.
 *
 * 시트 하나가 타입·라인 조합 하나라서, 시트가 곧 묶음 단위다.
 */
import * as XLSX from 'xlsx';
import type { OrderLine } from '@/lib/spec/organize';
import { parseLocation } from '@/lib/spec/location';

export interface DongilHeader {
  orderNo: string;
  site: string;
  content: string;       // 내용 칸 — "59A타입(1동 1라인) 21~24층"
  dueDate: string;
  bundleNo: string;      // 묶음번호 (있으면)
  shipOrder: string;     // 출고순서 (있으면)
}

const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => parseFloat(str(v).replace(/,/g, '')) || 0;

function rowsOf(ws: XLSX.WorkSheet) {
  // 8·9행 같은 고정 위치를 쓰므로 빈 행을 남기고(blankrows), 시작점을 A1에 못 박는다(range).
  // 시트 범위가 A3부터 시작하면 배열 인덱스가 밀리기 때문이다.
  const end = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).e : { r: 0, c: 0 };
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false, blankrows: true, range: { s: { r: 0, c: 0 }, e: end } });
}

/** 8·9행 머리가 사내 양식인지 */
export function isDongilSheet(ws: XLSX.WorkSheet): boolean {
  if (!ws['!ref']) return false;
  const rows = rowsOf(ws);
  const r8 = (rows[7] ?? []).map(str).join('|');
  const r9 = (rows[8] ?? []).map(str).join('|');
  return /주\s*문\s*내\s*역/.test(r8) && /외판\/내판/.test(r9) && /가로/.test(r9) && /세로/.test(r9);
}

/** 한 행에서 "라벨 다음 칸"의 값을 찾는다 (병합 셀 때문에 위치가 흔들려서) */
function after(row: unknown[], label: RegExp): string {
  const i = row.findIndex(c => label.test(str(c)));
  if (i < 0) return '';
  for (let j = i + 1; j < row.length; j++) { const v = str(row[j]); if (v) return v; }
  return '';
}

export function readDongilSheet(ws: XLSX.WorkSheet, sheetName: string): { header: DongilHeader; lines: OrderLine[] } {
  const rows = rowsOf(ws);
  const header: DongilHeader = {
    orderNo: after(rows[2] ?? [], /주문서\s*NO/),
    site: after(rows[4] ?? [], /현장명/),
    content: after(rows[4] ?? [], /^내\s*용$/),
    dueDate: after(rows[5] ?? [], /현장납기일/),
    bundleNo: after(rows[6] ?? [], /묶음번호/),
    shipOrder: after(rows[6] ?? [], /출고순서/),
  };
  // 시트의 내용 칸에서 동·라인·타입·층을 미리 뽑아 둔다 (품목 줄엔 실명만 있으니까)
  const ctx = parseLocation(header.content || sheetName);

  // 열 번호를 고정하지 않는다 — 파일마다 A열이 비어 있어 한 칸씩 밀리는 경우가 있다.
  // 9행(외판/내판·두께·가로·세로·단위·수량·개소·합계)과 8행(위치)의 머리글로 열을 찾는다.
  const col = (rowIdx: number, re: RegExp) => (rows[rowIdx] ?? []).findIndex(c => re.test(str(c)));
  const C = {
    product: col(8, /외판\/내판/), w: col(8, /가\s*로/), h: col(8, /세\s*로/),
    qty: col(8, /수\s*량/), places: col(8, /개\s*소/), total: col(8, /합\s*계/),
    loc: col(7, /^위\s*치$/),
  };
  if (C.product < 0 || C.w < 0 || C.h < 0) return { header, lines: [] };

  const lines: OrderLine[] = [];
  let productLines: string[] = [];
  let blockItems: OrderLine[] = [];
  const flush = () => {
    const product = productLines.join(' / ').trim();
    for (const it of blockItems) lines.push({ ...it, product: product || it.product });
    productLines = []; blockItems = [];
  };

  for (let r = 10; r <= rows.length; r++) {
    const row = rows[r - 1] ?? [];
    const b = str(row[C.product]);
    if (/^소\s*계$/.test(b) || /^합\s*계$/.test(b)) { flush(); continue; }
    if (/^결\s*재/.test(str(row[0])) || /^결\s*재/.test(b)) break;           // 결재란부터는 품목이 아니다
    if (b && !/^\d+$/.test(b)) productLines.push(b);
    const w = num(row[C.w]), h = num(row[C.h]);
    if (!w || !h) continue;
    const perUnit = C.qty >= 0 ? num(row[C.qty]) : 0;
    const places = C.places >= 0 ? num(row[C.places]) : 0;
    const total = C.total >= 0 ? num(row[C.total]) : 0;
    const qty = total || perUnit * places || perUnit;
    if (!qty) continue;
    const rawLoc = C.loc >= 0 ? str(row[C.loc]) : '';
    const loc = parseLocation(rawLoc);
    blockItems.push({
      row: r, sheet: sheetName, product: '', w, h, qty, rawLoc,
      dong: loc.dong ?? ctx.dong,
      ho: loc.ho?.[0],
      line: loc.line?.[0] ?? ctx.line?.[0],
      floor: loc.floor ?? ctx.floor,
      type: loc.type ?? ctx.type,
      room: loc.rest || rawLoc || undefined,
    });
  }
  flush();
  return { header, lines };
}

export function listDongilSheets(buffer: ArrayBuffer | Uint8Array): { name: string; lines: number; content: string }[] {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    if (!isDongilSheet(ws)) return { name, lines: 0, content: '' };
    const { header, lines } = readDongilSheet(ws, name);
    return { name, lines: lines.length, content: header.content };
  });
}

export function parseDongilOrder(buffer: ArrayBuffer | Uint8Array, sheetNames: string[]): { header: DongilHeader; lines: OrderLine[] } {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  let header: DongilHeader | null = null;
  const lines: OrderLine[] = [];
  for (const name of sheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !isDongilSheet(ws)) continue;
    const one = readDongilSheet(ws, name);
    if (!header) header = one.header;
    lines.push(...one.lines);
  }
  return { header: header ?? { orderNo: '', site: '', content: '', dueDate: '', bundleNo: '', shipOrder: '' }, lines };
}
