import ExcelJS from 'exceljs';
import templateJson from './bokcheung-template.json';
import {
  JAE_PER_M2, SUMMARY_COLUMNS, quantityNoteCell, summarizeTypes,
  type BokcheungBlock, type BokcheungEntry, type BokcheungSheet,
} from './bokcheung';

/**
 * 복층생산일지 엑셀 — 회사 양식과 같은 모양으로.
 *
 * 서식은 bokcheung-template.json 에 있다. 회사 "복층생산일지(2026).xlsx" 5월 16일 시트에서 서식만 뽑았고
 * (자료 값은 지우고 머리글 · 합계 이름표만 남김, 테마 색은 실제 색 값으로 바꿈) 칸 너비 · 줄 높이 · 병합 ·
 * 인쇄 설정(A4 세로 84%)까지 담았다. 그 설계도대로 줄을 놓으므로 주문이 16줄을 넘는 날도 줄만 늘어난다.
 *
 * 병합을 먼저 하고 서식을 나중에 입힌다 — exceljs 의 mergeCells 는 딸린 칸 서식을 첫 칸 것으로 덮어써서
 * 병합 영역 오른쪽 · 아래 테두리가 사라진다 (그래서 mergeCellsWithoutStyle).
 */

type CellSpec = [number] | [number, string | number];
interface RowSpec { height: number | null; cells: Record<string, CellSpec> }
interface BlockSpec { rows: RowSpec[]; subtotal: RowSpec }
interface TemplateSpec {
  columns: { width: number }[];
  pageSetup: Partial<ExcelJS.PageSetup>;
  views: Partial<ExcelJS.WorksheetView>[];
  header: { rows: RowSpec[]; merges: string[] };
  block1: BlockSpec;
  block2: BlockSpec;
  tail: { rows: RowSpec[]; merges: [number, string, string][] };
  styles: Partial<ExcelJS.Style>[];
}
const spec = templateJson as unknown as TemplateSpec;

/** 덩어리마다 양식에 있는 줄 수 — 넘치면 늘린다 */
export const TEMPLATE_ROWS = 16;
const FIRST_DATA_ROW = 8;

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 시트 이름 — 회사 파일처럼 "10월 30일" */
export function bokcheungSheetName(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일`;
}

/**
 * 줄 번호 배치 — 테스트도 같은 계산을 쓴다.
 * 1 · 2호기 덩어리는 양식대로 16줄(넘치면 늘림), 더한 호기 덩어리는 쓴 줄만큼(인쇄가 한 장을 넘지 않게).
 */
export function bokcheungLayout(sheet: BokcheungSheet) {
  let row = FIRST_DATA_ROW;
  const blocks = sheet.blocks.map((b, i) => {
    const n = i < 2 ? Math.max(TEMPLATE_ROWS, b.rows.length) : Math.max(1, b.rows.length);
    const start = row;
    const sub = start + n;
    row = sub + 1;
    return { start, n, sub };
  });
  const tail = row;
  const [b1, b2] = blocks;
  return { blocks, n1: b1.n, n2: b2.n, start1: b1.start, sub1: b1.sub, start2: b2.start, sub2: b2.sub, tail, last: tail + 3 };
}

/** 덩어리 i 번째 줄의 서식 — 양식의 16줄을 그대로 쓰고, 넘치면 가운데 줄 서식으로 늘린 뒤 마지막 줄 서식으로 닫는다 */
function blockRowSpec(block: BlockSpec, i: number, n: number): RowSpec {
  if (i < TEMPLATE_ROWS - 1) return block.rows[i];
  return i === n - 1 ? block.rows[TEMPLATE_ROWS - 1] : block.rows[TEMPLATE_ROWS - 2];
}

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DG Flow';
  // 엑셀이 열 때 수식을 다시 계산한다 — 아래 넣는 결과값은 엑셀 아닌 뷰어용
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

/** 하루치 한 장짜리 파일 */
export function buildBokcheungWorkbook(
  sheet: BokcheungSheet, entries: Record<string, BokcheungEntry | undefined>,
): ExcelJS.Workbook {
  const wb = newWorkbook();
  addBokcheungSheet(wb, sheet, entries, bokcheungSheetName(sheet.date));
  return wb;
}

/**
 * 기간 — 날짜마다 시트 한 장 (회사 복층생산일지(2026).xlsx 처럼 날짜순).
 * 시트 서식이 회사 파일과 같아서, 회사 파일로 시트를 옮겨(이동/복사) 이어 붙일 수 있다.
 * 같은 이름이 또 나오면(1년을 넘는 기간) 뒤에 연도를 붙인다.
 */
export function buildBokcheungRangeWorkbook(
  days: { sheet: BokcheungSheet; entries: Record<string, BokcheungEntry | undefined> }[],
): ExcelJS.Workbook {
  const wb = newWorkbook();
  const used = new Set<string>();
  for (const { sheet, entries } of [...days].sort((a, b) => a.sheet.date.localeCompare(b.sheet.date))) {
    let name = bokcheungSheetName(sheet.date);
    if (used.has(name)) name = `${name} (${sheet.date.slice(0, 4)})`;
    used.add(name);
    addBokcheungSheet(wb, sheet, entries, name);
  }
  return wb;
}

function addBokcheungSheet(
  wb: ExcelJS.Workbook, sheet: BokcheungSheet, entries: Record<string, BokcheungEntry | undefined>, name: string,
) {
  const L = bokcheungLayout(sheet);
  const ws = wb.addWorksheet(name, {
    views: spec.views.map(({ activeCell: _a, ...v }) => v) as ExcelJS.WorksheetView[],
  });
  Object.assign(ws.pageSetup, spec.pageSetup, { printArea: `A1:L${L.last}` });
  spec.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  // 1) 병합 먼저
  for (const m of spec.header.merges) ws.mergeCellsWithoutStyle(m);
  for (const [o, a, b] of spec.tail.merges) ws.mergeCellsWithoutStyle(`${a}${L.tail + o}:${b}${L.tail + o}`);

  // 2) 줄마다 서식(+ 이름표)
  const put = (r: number, row: RowSpec) => {
    if (row.height != null) ws.getRow(r).height = row.height;
    for (const [col, [s, v]] of Object.entries(row.cells)) {
      const cell = ws.getCell(`${col}${r}`);
      cell.style = structuredClone(spec.styles[s]);
      if (v !== undefined) cell.value = v;
    }
  };
  const set = (addr: string, v: ExcelJS.CellValue) => { if (v !== null && v !== undefined && v !== '') ws.getCell(addr).value = v; };

  spec.header.rows.forEach((row, i) => put(i + 1, row));
  const [y, mo, d] = sheet.date.split('-').map(Number);
  ws.getCell('B5').value = new Date(Date.UTC(y, mo - 1, d));

  const writeBlock = (block: BokcheungBlock, bs: BlockSpec, start: number, n: number, subRow: number) => {
    let kTotal = 0;
    for (let i = 0; i < n; i++) {
      const r = start + i;
      put(r, blockRowSpec(bs, i, n));
      const row = block.rows[i];
      const k = round4((row?.area_m2 ?? 0) * JAE_PER_M2);
      kTotal += k;
      ws.getCell(`K${r}`).value = { formula: `+M${r}*N${r}`, result: k };
      ws.getCell(`N${r}`).value = JAE_PER_M2;
      if (!row) continue;
      const e = entries[row.key];
      if (!row.continued) {
        set(`A${r}`, row.work_order_number);
        set(`B${r}`, row.customer_site);
      }
      set(`C${r}`, e?.glass_type?.trim() || null);
      set(`D${r}`, row.composition);
      set(`E${r}`, row.thickness);
      set(`F${r}`, row.argon ? 'AR' : null);
      set(`G${r}`, row.width_mm);
      set(`H${r}`, row.height_mm);
      set(`I${r}`, quantityNoteCell(e?.quantity_note));
      set(`J${r}`, row.quantity);
      set(`M${r}`, row.area_m2);
    }
    put(subRow, bs.subtotal);
    ws.getCell(`J${subRow}`).value = { formula: `SUM(J${start}:J${start + n - 1})`, result: block.quantity };
    ws.getCell(`K${subRow}`).value = { formula: `SUM(K${start}:K${start + n - 1})`, result: round4(kTotal) };
  };
  // 1호기는 양식 위 덩어리 서식(초록 소계), 2호기부터는 아래 덩어리 서식(주황 소계)
  sheet.blocks.forEach((block, i) => {
    const lay = L.blocks[i];
    writeBlock(block, i === 0 ? spec.block1 : spec.block2, lay.start, lay.n, lay.sub);
  });

  spec.tail.rows.forEach((row, o) => put(L.tail + o, row));
  // 종류별 합계 — 회사 수식 그대로 (범위는 첫 데이터 줄부터 아래 굵은 선 줄까지)
  const sumRow = L.tail + 2;
  const typeRange = `$C$${FIRST_DATA_ROW}:$C$${L.tail}`;
  const qtyRange = `$J$${FIRST_DATA_ROW}:$J$${L.tail}`;
  const { counts, total } = summarizeTypes(sheet, entries);
  const SUMMARY_CELLS = ['A', 'B', 'C', 'E', 'H'];
  SUMMARY_COLUMNS.forEach((c, i) => {
    ws.getCell(`${SUMMARY_CELLS[i]}${sumRow}`).value = { formula: `SUMIF(${typeRange},"${c.match}",${qtyRange})`, result: counts[i] };
  });
  ws.getCell(`J${sumRow}`).value = { formula: `SUM(A${sumRow}:I${sumRow})`, result: total };
  // 누계 — 수량(조)과 재
  ws.getCell(`C${L.tail + 3}`).value = sheet.cumulative.quantity;
  ws.getCell(`J${L.tail + 3}`).value = round2(sheet.cumulative.area_m2 * JAE_PER_M2);
}
