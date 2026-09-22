/**
 * 우미(=KCC) 양식 발주서 파서.
 *
 * 이 양식은 위치 문장(C열) 옆에 구조화된 열이 따로 있다:
 *   I 동호 "1동 2호" · J 실명 "주방/식당(外)" · K 타입 층 "84B 31~35F"
 * 고객이 손으로 적은 C열은 띄어쓰기·층이 흐트러지므로 I·J·K 를 읽고, C열은 원본 표시용으로만 둔다.
 *
 * 품목은 15행부터, 품명(B열)은 블록 첫 줄에만 있어 아래로 채운다.
 */
import * as XLSX from 'xlsx';
import type { OrderLine } from '@/lib/spec/organize';

export interface WoomiHeader {
  orderNo: string;     // H2
  site: string;        // B4
  contractor: string;  // H4  시공자
  orderDate: string;   // B6
  dueDate: string;     // B7
  place: string;       // G7  도착장소
  note: string;        // A11~A12 고객 지시 문장
}

export interface WoomiSheetInfo {
  name: string;
  lines: number;
  recommended: boolean;
}

const DATA_START = 15;
const num = (v: unknown) => parseFloat(String(v ?? '').replace(/,/g, '').trim()) || 0;
const str = (v: unknown) => String(v ?? '').trim();

function readSheet(ws: XLSX.WorkSheet): { header: WoomiHeader; lines: OrderLine[] } {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
  const cell = (r: number, c: number) => (rows[r - 1] ?? [])[c];

  const header: WoomiHeader = {
    orderNo: str(cell(2, 7)),
    site: str(cell(4, 1)),
    contractor: str(cell(4, 7)),
    orderDate: str(cell(6, 1)),
    dueDate: str(cell(7, 1)),
    place: str(cell(7, 6)),
    note: [str(cell(11, 0)), str(cell(12, 0))].filter(Boolean).join(' '),
  };

  const lines: OrderLine[] = [];
  let product = '';
  for (let r = DATA_START; r <= rows.length; r++) {
    const b = str(cell(r, 1));
    if (b) product = b;
    const dh = str(cell(r, 8)).match(/^(\d+)동 (\d+)호$/);
    const tk = str(cell(r, 10)).match(/^(\S+)\s+(\S+)$/);
    const room = str(cell(r, 9));
    const w = num(cell(r, 3)), h = num(cell(r, 4)), qty = num(cell(r, 5));
    if (!dh || !tk || !room || !w || !h || qty === 0) continue;   // 수량 0 빈 줄은 없는 것으로
    lines.push({
      row: r, product, dong: +dh[1], ho: +dh[2], type: tk[1], floor: tk[2], room,
      w, h, qty, rawLoc: str(cell(r, 2)),
    });
  }
  return { header, lines };
}

/** 이 양식인지 — 13행에 "위 치 / 제 품 명" 머리가 있고 I~K열에 구조화된 값이 있어야 한다 */
export function isWoomiSheet(ws: XLSX.WorkSheet): boolean {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false, range: 'A13:K40' });
  const head = rows[0] ?? [];
  const hasHead = /위\s*치/.test(str(head[0])) && /제\s*품\s*명/.test(str(head[1]));
  const hasStruct = rows.slice(2).some(r => /^\d+동 \d+호$/.test(str(r[8])));
  return hasHead && hasStruct;
}

export function listWoomiSheets(buffer: ArrayBuffer): WoomiSheetInfo[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const infos = wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    const lines = ws && ws['!ref'] && isWoomiSheet(ws) ? readSheet(ws).lines.length : 0;
    return { name, lines, recommended: false };
  });
  const best = infos.reduce<WoomiSheetInfo | null>((a, b) => (!a || b.lines > a.lines ? b : a), null);
  if (best && best.lines > 0) best.recommended = true;
  return infos;
}

export function parseWoomiOrder(buffer: ArrayBuffer, sheetName: string): { header: WoomiHeader; lines: OrderLine[] } {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`시트 "${sheetName}" 가 없습니다.`);
  return readSheet(ws);
}
