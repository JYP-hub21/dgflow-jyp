/**
 * 규격정리 엑셀 생성
 *
 * 규격정리는 발주서와 ERP 사이의 중간 산출물이다. 지금은 사원이 손으로 만든다.
 * 실물(규격정리-KCC건설.xlsx)을 뜯어 보니 구조가 완전히 기계적이었다.
 *
 *   품명 머리글 행  : `24T 5MVT172+14단열(Ar.)+5CL`  + 날짜
 *   헤더 행        : `위치 | 규 | 격 | 수량 | 평` ‖ `위치 | 규 | 격 | 수량 | 평 | M2`
 *   좌측 블록      : **발주서 순서 그대로**
 *   우측 블록      : ERP 순서 (세로↓ 가로↓)
 *   합계 행        : 좌·우 각각 수량·평 합
 *
 * 우측 블록이 곧 ERP 업로드 엑셀의 내용이다 — 실물에서 문자 단위로 같았다.
 *
 * **품명만 사람이 채운다.** 발주서 품명(`5MVT172 H/S+ 14Ar + 5CL(근생)`)을
 * 회사 ERP 품목명(`24T 5MVT172+14단열(Ar.)+5CL`)으로 바꾸는 일은 규칙이 없어 자동화할 수 없다.
 * 그래서 발주서 품명을 그대로 적어 두고, 고쳐 달라는 표시를 남긴다.
 *
 * 2026-11-10 사용자 "엑셀까지 다운로드 안 해도 이런 기준이면 어떻게 규격정리되는지 미리 볼 수 있으면" —
 * 계산을 `specSheetBlocks` 로 떼어 화면 미리보기(`components/erp/SpecSheetPreview`)와 엑셀이 같은 값을 쓴다.
 *
 * **덩어리 = 포장 × 품명** (2026-11-10 고침). 실물 규격정리-우미건설 은 품명 머리글이 포장마다 되풀이된다
 * ("1포장 / 22T 5newGN…", "22T 5CL…", "2포장 / 22T 5newGN…" …). 예전에는 발주서 덩어리마다 오른쪽을
 * '같은 품명의 ERP 줄 전부' 로 채워서, 품명이 여러 포장에 나오는 발주서(우미 7차)는 오른쪽이 덩어리 수만큼
 * 되풀이됐다(3,740장 → 82,660장). 이제 오른쪽 = 그 포장 시트의 그 품명 ERP 줄(ERP 순서), 왼쪽 = 그 줄이 나온
 * 발주서 행(`source_rows`, 발주서 순서). 포장 방식을 바꾸면 규격정리도 그 포장대로 다시 묶인다.
 *
 * **엑셀 모양은 회사 실물 그대로** (2026-11-10 점검). 예전 SheetJS 판은 서식이 없어 인쇄하면 왼쪽(발주서)과
 * 오른쪽(ERP)이 다른 쪽에 찍혔다(우미 7차 A4 33쪽, 왼쪽은 1쪽에만). 평이 소수 6자리, 값은 상수, 날짜도 없었다.
 * 실물(규격정리-우미건설 · KCC건설)을 뜯어 그대로 옮긴다 — A4 세로 · 너비 1쪽에 맞춤 · 가로 가운데,
 * 바탕 10pt(위치 8pt) · 칸마다 가는 선(hair) · 바깥과 좌우 사이 굵은 선 · 합계 행 이중선, 품명 굵게(B:D 병합),
 * E 열 날짜 'yy.mm.dd', 우측 품명 = `=B행`(H:J 병합), 평 = `=SUM(B*C/91809*D)` · M2 = `=(H/1000*I/1000)*J` ·
 * 합계 = SUM 수식 — 사원이 칸을 고치면 다시 계산된다. 덩어리 사이 빈 줄은 없다(실물도 없다).
 * exceljs 는 무거워(약 1MB) 받기를 누를 때만 불러온다.
 */
import type { Borders, Cell, Workbook } from 'exceljs';
import type { OrderScan, ScanRow } from '@/lib/parser/order-scan';
import type { ErpUploadBuild, ErpUploadRow } from './upload-sheet';

/**
 * `평` 이라고 적힌 열은 실제로는 **재(才)** 다.
 *
 * 실물에서 역산해 확인했다 — 규격정리 828행 `195×540×1` 의 평 값이 `1.1469463778060975`.
 * 면적 0.1053 m² 를 그 값으로 나누면 0.091809 = 0.303² 가 나온다.
 * 유리 업계에서 1재 = 1尺² = 303mm × 303mm 이므로 이 열은 재수다.
 * (1평 = 3.3058 m² 로 계산하면 0.0319 가 나와 실물과 전혀 맞지 않는다)
 */
const SAI_M2 = 0.303 * 0.303;
const round = (n: number, digits = 6) => Number(n.toFixed(digits));

export interface SpecRow {
  location: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  /** 재(엑셀의 '평' 열) — 소수 6자리 */
  sai: number;
  m2: number;
}

/** 포장 하나 × 품명 하나의 덩어리 — 좌 = 발주서 순서, 우 = ERP 순서 */
export interface SpecBlock {
  /** 포장 이름(ERP 시트) — 어느 포장에도 안 들어간 발주서 품목은 '포장 미배정' */
  package_label: string;
  /** 그 포장의 첫 덩어리인지 — 엑셀 품명 머리글 맨 앞 칸에 포장 이름을 적는다(실물 "1포장") */
  first_in_package: boolean;
  product_name: string;
  /** 우측 품명 칸 — DG 프리즘이 사내 품명을 제안했으면 그것, 아니면 발주서 품명 그대로 */
  erp_name: string;
  left: SpecRow[];
  right: SpecRow[];
  left_qty: number;
  left_sai: number;
  right_qty: number;
  right_sai: number;
  right_m2: number;
}

const HEADER = ['위치', '규', '격', '수량', '평', '', '위치', '규', '격', '수량', '평', 'M2'];

const specRow = (r: { location: string; width_mm: number; height_mm: number; quantity: number }): SpecRow => {
  const area = (r.width_mm * r.height_mm * r.quantity) / 1_000_000;
  return { location: r.location, width_mm: r.width_mm, height_mm: r.height_mm, quantity: r.quantity, sai: round(area / SAI_M2), m2: round(area, 6) };
};

/**
 * 발주서 순서(좌) + ERP 순서(우) 덩어리를 포장 × 품명으로 만든다 — 엑셀과 화면 미리보기가 같이 쓴다.
 *
 * @param scan     발주서 구조 스캔 — 좌측(발주서 순서)의 근거
 * @param build    ERP 빌드 결과 — 덩어리(포장 시트 × 품명)와 우측(ERP 순서)의 근거
 * @param excluded 이번 ERP 에서 뺀 품목 행(행 열쇠) — 좌측에서도 뺀다(그래야 좌우 합계가 맞는다)
 */
export function specSheetBlocks(
  scan: OrderScan, build: ErpUploadBuild,
  productNames: Record<string, string> = {},
  excluded: Iterable<number> = [],
): SpecBlock[] {
  const ex = new Set(excluded);
  const order = new Map<number, number>();
  const byKey = new Map<number, ScanRow>();
  scan.rows.forEach((r, i) => {
    if (r.kind !== 'item' || ex.has(r.excel_row)) return;
    order.set(r.excel_row, i);
    byKey.set(r.excel_row, r);
  });
  const byOrder = (a: number, b: number) => order.get(a)! - order.get(b)!;
  const left = (keys: number[]) => keys.sort(byOrder).map(k => {
    const r = byKey.get(k)!;
    return specRow({ location: r.location_text || assembled(r), width_mm: r.width_mm, height_mm: r.height_mm, quantity: r.quantity });
  });
  const block = (package_label: string, first_in_package: boolean, product: string, l: SpecRow[], r: SpecRow[]): SpecBlock => ({
    package_label, first_in_package,
    product_name: product,
    erp_name: productNames[product] || product,
    left: l, right: r,
    left_qty: sum(l, x => x.quantity),
    left_sai: round(sum(l, x => x.width_mm * x.height_mm * x.quantity / 1_000_000 / SAI_M2)),
    right_qty: sum(r, x => x.quantity),
    right_sai: round(sum(r, x => x.width_mm * x.height_mm * x.quantity / 1_000_000 / SAI_M2)),
    right_m2: round(sum(r, x => x.width_mm * x.height_mm * x.quantity / 1_000_000)),
  });

  const used = new Set<number>();
  const out: SpecBlock[] = [];
  for (const sheet of build.sheets) {
    // 포장 안에서 품명이 처음 나온 순서대로 덩어리를 만든다
    const sections = new Map<string, { right: ErpUploadRow[]; keys: number[] }>();
    for (const r of sheet.rows) {
      let sec = sections.get(r.product_name);
      if (!sec) { sec = { right: [], keys: [] }; sections.set(r.product_name, sec); }
      sec.right.push(r);
      for (const k of r.source_rows ?? []) {
        if (byKey.has(k) && !used.has(k)) { used.add(k); sec.keys.push(k); }
      }
    }
    let first = true;
    for (const [product, sec] of sections) {
      out.push(block(sheet.packaging_label, first, product, left(sec.keys), sec.right.map(specRow)));
      first = false;
    }
  }

  // 어느 포장에도 안 들어간 발주서 품목(ERP 의 _미배정) — 왼쪽에만 둔다
  const rest = [...byKey.keys()].filter(k => !used.has(k)).sort(byOrder);
  const restBy = new Map<string, number[]>();
  for (const k of rest) {
    const name = byKey.get(k)!.product_name;
    restBy.set(name, [...(restBy.get(name) ?? []), k]);
  }
  let first = true;
  for (const [product, keys] of restBy) {
    out.push(block('포장 미배정', first, product, left(keys), []));
    first = false;
  }
  return out;
}

/** 엑셀 머리글 · 날짜 · 인쇄 머리글에 넣을 것 */
export interface SpecSheetOptions {
  /** 품명 머리글 E 열 날짜(실물 '26.04.01') — 없으면 오늘 */
  date?: Date;
  /** 인쇄 머리글 — 실물은 왼쪽에 거래처, 가운데에 현장 */
  customerName?: string;
  siteName?: string;
}

/* ── 실물 서식 (규격정리-우미건설 '남원주 역세권' 시트에서 뽑음 · KCC 도 같은 틀) ───────────── */
const FONT = '바탕';
/** 실물 회계 서식 — 0 이면 '-' 로 보인다 */
const INT_FMT = '_-* #,##0_-;-* #,##0_-;_-* "-"_-;_-@_-';
const DEC_FMT = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"_-;_-@_-';
const WIDTHS = [27.125, 11.375, 10.375, 6.75, 10.625, 1.0, 28.25, 9.875, 9, 8.125, 10.625, 8.5];
const ROW_HEIGHT = 15;
/** 1재 = 303 × 303 = 91,809 mm² — 실물 수식의 숫자 그대로 */
const SAI_MM2 = 91809;

type Line = 'hair' | 'medium' | 'double';
const edge = (style: Line) => ({ style, color: { argb: 'FF000000' } });

/**
 * 칸 테두리 — 칸마다 가는 선, 바깥(A 왼쪽 · L 오른쪽)과 좌우 사이(F · G 왼쪽)는 굵은 선.
 * 품명 머리글은 위가 굵은 선, 합계 행은 위아래 이중선(실물 그대로 F · G 왼쪽은 가는 선).
 */
function borderOf(col: number, kind: 'title' | 'body' | 'total'): Partial<Borders> {
  const thickLeft = col === 1 || ((col === 6 || col === 7) && kind !== 'total');
  return {
    left: edge(thickLeft ? 'medium' : 'hair'),
    right: edge(col === 12 ? 'medium' : 'hair'),
    top: edge(kind === 'title' ? 'medium' : kind === 'total' ? 'double' : 'hair'),
    bottom: edge(kind === 'total' ? 'double' : 'hair'),
  };
}

/** 'yy.mm.dd' — 실물 E 열 표기. 그 PC 의 날짜(한국)로 찍는다 */
export function specSheetDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getFullYear() % 100)}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** 인쇄 머리글 글자 — '&' 는 머리글 명령이라 두 번 적어야 글자로 찍힌다 */
const hf = (s: string) => s.replace(/&/g, '&&');

/** exceljs 를 받기 누를 때만 불러온다 — 브라우저(UMD 묶음)와 Node(CJS)가 내보내는 모양이 달라 둘 다 받는다 */
async function loadExcelJS(): Promise<typeof import('exceljs')> {
  const mod = await import('exceljs');
  return (mod as unknown as { default?: typeof import('exceljs') }).default ?? mod;
}

/** 발주서 순서(좌) + ERP 순서(우) 2단 구조로 규격정리를 만든다 — 실물과 같은 서식 · 수식 · 인쇄 설정. */
export async function buildSpecSheetWorkbook(
  scan: OrderScan, build: ErpUploadBuild,
  /** 발주서 품명 → 사내(ERP) 품명. 있으면 우측 품명 칸에 넣는다 (DG 프리즘 제안, 사람이 확인) */
  productNames: Record<string, string> = {},
  excluded: Iterable<number> = [],
  opts: SpecSheetOptions = {},
): Promise<Workbook> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  // 값은 계산해 넣어 두지만(수식 결과), 사원이 고친 뒤에도 맞게 열 때 다시 계산하게 한다
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('규격정리');
  ws.properties.defaultRowHeight = ROW_HEIGHT;
  WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // 인쇄 — A4 세로, 너비 1쪽에 맞춤(높이는 자동), 가로 가운데. 실물 여백 · 머리글 · 쪽 번호 그대로
  Object.assign(ws.pageSetup, {
    paperSize: 9, orientation: 'portrait',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.236, right: 0.236, top: 0.472, bottom: 0.472, header: 0.315, footer: 0.315 },
  });
  const head = [opts.customerName ? `&L${hf(opts.customerName)}` : '', opts.siteName ? `&C${hf(opts.siteName)}` : ''].join('');
  if (head) ws.headerFooter.oddHeader = head;
  ws.headerFooter.oddFooter = '&C&N페이지 중 &P페이지';

  const date = specSheetDate(opts.date ?? new Date());
  const style = (cell: Cell, col: number, kind: 'title' | 'body' | 'total', extra: { size?: number; bold?: boolean; fmt?: string; align?: 'left' | 'center' } = {}) => {
    cell.font = { name: FONT, size: extra.size ?? 10, bold: extra.bold || undefined };
    cell.border = borderOf(col, kind);
    cell.alignment = { horizontal: extra.align ?? 'center', vertical: 'middle' };
    if (extra.fmt) cell.numFmt = extra.fmt;
  };

  let r = 1;
  for (const b of specSheetBlocks(scan, build, productNames, excluded)) {
    // ① 품명 머리글 — A 포장 이름(그 포장의 첫 덩어리만) · B:D 발주서 품명 · E 날짜 · H:J 우측 품명
    //   우측 품명은 실물처럼 `=B행` — 사원이 B 를 사내 품목명으로 고치면 따라온다. DG 프리즘 제안이 있으면 그 글자를 넣는다.
    ws.mergeCellsWithoutStyle(r, 2, r, 4);
    ws.mergeCellsWithoutStyle(r, 8, r, 10);
    const title = ws.getRow(r);
    title.height = ROW_HEIGHT;
    for (let c = 1; c <= 12; c++) style(title.getCell(c), c, 'title');
    if (b.first_in_package) title.getCell(1).value = b.package_label;
    title.getCell(2).value = b.product_name;
    style(title.getCell(2), 2, 'title', { bold: true });
    title.getCell(5).value = date;
    style(title.getCell(5), 5, 'title', { bold: true });
    title.getCell(8).value = b.erp_name === b.product_name ? { formula: `B${r}`, result: b.product_name } : b.erp_name;
    style(title.getCell(8), 8, 'title', { bold: true, size: 9 });
    r++;

    // ② 열 머리글
    const header = ws.getRow(r);
    header.height = ROW_HEIGHT;
    HEADER.forEach((h, i) => {
      const cell = header.getCell(i + 1);
      if (h) cell.value = h;
      style(cell, i + 1, 'body');
    });
    r++;

    // ③ 줄 — 좌 = 발주서 순서, 우 = ERP 순서. 평 · M2 는 실물 수식 (값은 결과로도 넣어 둔다)
    const first = r;
    const depth = Math.max(b.left.length, b.right.length);
    for (let i = 0; i < depth; i++, r++) {
      const row = ws.getRow(r);
      row.height = ROW_HEIGHT;
      for (let c = 1; c <= 12; c++) style(row.getCell(c), c, 'body');
      const L = b.left[i];
      const R = b.right[i];
      if (L) {
        row.getCell(1).value = L.location;
        row.getCell(2).value = L.width_mm;
        row.getCell(3).value = L.height_mm;
        row.getCell(4).value = L.quantity;
        row.getCell(5).value = { formula: `SUM(B${r}*C${r}/${SAI_MM2}*D${r})`, result: L.sai };
      }
      if (R) {
        row.getCell(7).value = R.location;
        row.getCell(8).value = R.width_mm;
        row.getCell(9).value = R.height_mm;
        row.getCell(10).value = R.quantity;
        row.getCell(11).value = { formula: `SUM(H${r}*I${r}/${SAI_MM2}*J${r})`, result: R.sai };
        row.getCell(12).value = { formula: `(H${r}/1000*I${r}/1000)*J${r}`, result: R.m2 };
      }
      style(row.getCell(1), 1, 'body', { size: 8, align: 'left' });
      style(row.getCell(7), 7, 'body', { size: 8, align: 'left' });
      for (const c of [2, 3, 4, 8, 9, 10]) style(row.getCell(c), c, 'body', { fmt: INT_FMT });
      for (const c of [5, 11, 12]) style(row.getCell(c), c, 'body', { fmt: DEC_FMT });
    }
    const last = r - 1;

    // ④ 합계 — SUM 수식 (줄이 없으면 0)
    const total = ws.getRow(r);
    total.height = ROW_HEIGHT;
    for (let c = 1; c <= 12; c++) style(total.getCell(c), c, 'total');
    const sumOf = (col: string, result: number) => (last >= first ? { formula: `SUM(${col}${first}:${col}${last})`, result } : 0);
    total.getCell(4).value = sumOf('D', b.left_qty);
    total.getCell(5).value = sumOf('E', b.left_sai);
    total.getCell(10).value = sumOf('J', b.right_qty);
    total.getCell(11).value = sumOf('K', b.right_sai);
    total.getCell(12).value = sumOf('L', b.right_m2);
    for (const c of [4, 10]) style(total.getCell(c), c, 'total', { fmt: INT_FMT });
    for (const c of [5, 11, 12]) style(total.getCell(c), c, 'total', { fmt: DEC_FMT });
    r++;
  }
  return wb;
}

function sum<T>(rows: T[], f: (row: T) => number): number {
  return rows.reduce((s, r) => s + f(r), 0);
}

function assembled(r: { location_dong: string; location_line: string; location_type: string; location_floor: string; location_room: string }): string {
  return [r.location_dong, r.location_line, r.location_type, r.location_floor, r.location_room]
    .filter(Boolean)
    .join(' ');
}

export async function specSheetBlob(
  scan: OrderScan, build: ErpUploadBuild, productNames: Record<string, string> = {}, excluded: Iterable<number> = [],
  opts: SpecSheetOptions = {},
): Promise<Blob> {
  const wb = await buildSpecSheetWorkbook(scan, build, productNames, excluded, opts);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function specSheetFileName(siteName: string, sheetName: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  return ['규격정리', safe(siteName), safe(sheetName)].filter(Boolean).join('_') + '.xlsx';
}
