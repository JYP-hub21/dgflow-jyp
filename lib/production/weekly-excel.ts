import ExcelJS from 'exceljs';
import templateJson from './weekly-template.json';
import {
  CREW_COLUMNS, DEFAULT_SETTINGS, EMPTY_DAY_ENTRY, dayKey, lineHasData,
  type WeeklyDayEntry, type WeeklyLineSheet, type WeeklySettings, type WeeklySheet,
} from './weekly';

/**
 * 주간생산일지 엑셀 — 회사 양식 그대로.
 *
 * 서식 · 수식은 weekly-template.json 에 있다. 회사 "주간생산일지(2026).xlsx" 의 '양식' 시트에서 뽑았고
 * (주마다 적는 값 · 사람 이름은 뺐다) 칸 너비 · 줄 높이 · 병합 · 숨긴 칸 · 인쇄 설정까지 담았다.
 * 위 표의 수식이 그대로 살아 있어서 **맨 아래 복층 · 3복층 칸을 고치면 위 표가 전부 바뀐다** (2026-11-06 요청).
 *
 * 양식과 다른 곳 세 군데:
 *  · 바코드 입력 비율은 생산조가 0 인 날 #DIV/0! 가 인쇄물에 ##### 으로 나와 IFERROR 로 감쌌다.
 *  · 소계 줄도 그 호기가 한 주 내내 쉬면 #DIV/0! 가 나와 IFERROR 로 감쌌다. 값이 있으면 양식과 같다.
 *  · 75행 이후 야간 표는 뺐다 — 쓰지 않고, 수식이 깨져(#REF!) 있다.
 * 결재란은 원본도 칸을 찍은 그림이라 같은 자리에 그림으로 넣었다.
 *
 * 양식은 호기 표가 둘이다. 더한 호기(미니라인 등)는 같은 양식의 시트를 하나 더 만들어 표 이름만 바꾼다
 * (회의: 미니라인을 1 · 2호기만큼 쓸 수 있다). 기록이 있는 호기만 시트가 생긴다.
 */

type CellValue = string | number | { f: string } | { r: ExcelJS.RichText[] };
type CellSpec = [number] | [number, CellValue];
interface RowSpec { height: number | null; hidden?: boolean; cells: Record<string, CellSpec> }
interface TemplateSpec {
  columns: { width: number | null; hidden?: boolean }[];
  pageSetup: Partial<ExcelJS.PageSetup> & { horizontalDpi?: number; verticalDpi?: number };
  printArea: string;
  views: Partial<ExcelJS.WorksheetView>[];
  defaultRowHeight: number;
  merges: string[];
  dataValidations: Record<string, ExcelJS.DataValidation>;
  rows: Record<string, RowSpec>;
  approval: { png: string };
  styles: Partial<ExcelJS.Style>[];
}
const spec = templateJson as unknown as TemplateSpec;

/** 호기별 표 · 맨 아래 칸이 시작하는 줄 */
export const WEEKLY_LAYOUT = [
  { topRow: 7, totalRow: 13, bottomRow: 36 },
  { topRow: 23, totalRow: 29, bottomRow: 56 },
] as const;

/** 결재란 자리 — 원본 그림의 시작 · 끝 칸 (열 번호는 0 부터, 단위 EMU) */
const APPROVAL_ANCHORS = [
  { tl: { nativeCol: 30, nativeColOff: 1548093, nativeRow: 1, nativeRowOff: 163606 },
    br: { nativeCol: 31, nativeColOff: 0, nativeRow: 3, nativeRowOff: 163607 } },
  { tl: { nativeCol: 30, nativeColOff: 1546412, nativeRow: 17, nativeRowOff: 100853 },
    br: { nativeCol: 31, nativeColOff: 0, nativeRow: 19, nativeRowOff: 155202 } },
];

/** 소계 · 일평균 줄 — 쉰 호기는 0 으로 나누게 된다 */
const TOTAL_ROWS = new Set([13, 14, 29, 30]);
const totalFormula = (row: number, f: string) =>
  (TOTAL_ROWS.has(row) && !/^(IFERROR|SUM|COUNTA)\(/.test(f) ? `IFERROR(${f},0)` : f);

const dayOf = (date: string) => Number(date.slice(8, 10));
const monthOf = (date: string) => Number(date.slice(5, 7));

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DG Flow';
  // 엑셀이 열 때 수식을 다시 계산한다 — 아래 넣는 결과값은 엑셀 아닌 뷰어용
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

/** 호기 표의 수식 칸 결과 — 엑셀이 아닌 뷰어(폰 미리보기 등)에서도 값이 보이게 */
function lineResults(block: WeeklyLineSheet, layout: typeof WEEKLY_LAYOUT[number], results: Map<string, ExcelJS.CellValue>) {
  block.rows.forEach((row, i) => {
    const r = layout.topRow + i;
    const put = (col: string, v: ExcelJS.CellValue) => results.set(`${col}${r}`, v);
    put('H', row.jo > 0 ? (row.barcode ?? 0) / row.jo * 100 : '');
    put('S', row.crewTotal);
    put('T', row.target);
    put('U', row.jo);
    put('V', row.joPerHour);
    put('W', row.joRate);
    put('X', row.m2);
    put('Y', row.m2PerHour);
    put('Z', row.m2Rate);
    put('AA', row.scoreA);
    put('AB', row.scoreB);
    put('AC', row.score);
    put('AD', row.grade);
    const base = layout.bottomRow + i * 3;
    results.set(`H${base + 2}`, row.jo);
    results.set(`K${base + 2}`, row.m2);
  });
  const t = block.totals;
  const r = layout.totalRow;
  for (const [col, v] of Object.entries({
    F: t.hours, T: t.target, U: t.jo, V: t.joPerHour, W: t.joRate, X: t.m2, Y: t.m2PerHour, Z: t.m2Rate,
    AA: t.scoreA, AB: t.scoreB, AC: t.score, AD: t.grade,
  })) results.set(`${col}${r}`, v);
}

/** 더한 호기가 하나뿐인 시트 — 아래 표를 숨겨 표 하나만 인쇄한다 */
function hideSecondBlock(ws: ExcelJS.Worksheet) {
  for (let r = 18; r <= 34; r++) ws.getRow(r).hidden = true;
  for (let r = 55; r <= 74; r++) ws.getRow(r).hidden = true;
  ws.pageSetup.printArea = 'B2:AE17';
}

/** 호기 이름을 표 제목 · 머리글 · 맨 아래 칸에 넣는다 — 1 · 2호기 시트는 양식 그대로라 부르지 않는다 */
function nameBlock(ws: ExcelJS.Worksheet, index: number, name: string) {
  const [title, crew, bottom] = index === 0 ? ['B3', 'I5', 'C37'] : ['B19', 'I21', 'C57'];
  const value = ws.getCell(title).value as ExcelJS.CellRichTextValue;
  ws.getCell(title).value = { richText: [value.richText[0], { ...value.richText[1], text: name }] };
  ws.getCell(crew).value = `생산 투입 총 인원-${name}`;
  ws.getCell(bottom).value = name;
}

/** 한 시트 — 호기 표 둘. 시트 이름은 회사 파일처럼 토요일 "1031" */
export function addWeeklySheet(
  wb: ExcelJS.Workbook, sheet: WeeklySheet, entries: Record<string, WeeklyDayEntry | undefined>,
  settings: WeeklySettings = DEFAULT_SETTINGS, sheetName = sheet.week.sheetName,
) {
  const { week } = sheet;
  const ws = wb.addWorksheet(sheetName, {
    views: spec.views as ExcelJS.WorksheetView[],
    properties: { defaultRowHeight: spec.defaultRowHeight } as ExcelJS.WorksheetProperties,
  });
  const { horizontalDpi: _h, verticalDpi: _v, ...pageSetup } = spec.pageSetup;
  Object.assign(ws.pageSetup, pageSetup, { printArea: spec.printArea });
  spec.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.width !== null) col.width = c.width;
    if (c.hidden) col.hidden = true;
  });

  // 병합을 먼저 — exceljs 의 mergeCells 는 딸린 칸 서식을 덮어쓴다 (복층생산일지와 같은 이유)
  for (const m of spec.merges) ws.mergeCellsWithoutStyle(m);

  const results = new Map<string, ExcelJS.CellValue>();
  sheet.lines.forEach((block, i) => lineResults(block, WEEKLY_LAYOUT[i], results));
  // 날짜 칸 — 달이 바뀌는 줄은 회사 파일처럼 1 을 직접 적는다
  const literalDays = new Set<number>();
  week.days.forEach((d, i) => {
    results.set(`C${7 + i}`, dayOf(d));
    results.set(`C${23 + i}`, dayOf(d));
    results.set(`E${36 + i * 3}`, dayOf(d));
    results.set(`E${56 + i * 3}`, dayOf(d));
    if (i > 0 && dayOf(d) === 1) literalDays.add(i);
  });
  results.set('B23', monthOf(week.days[0]));
  results.set('AA20', 50);
  results.set('AB20', 54.45);
  results.set('AB4', 54.45);

  for (const [key, row] of Object.entries(spec.rows)) {
    const r = Number(key);
    const excelRow = ws.getRow(r);
    if (row.height !== null) excelRow.height = row.height;
    if (row.hidden) excelRow.hidden = true;
    for (const [col, [style, value]] of Object.entries(row.cells) as [string, CellSpec][]) {
      const cell = ws.getCell(`${col}${r}`);
      cell.style = structuredClone(spec.styles[style]);
      if (value === undefined) continue;
      if (typeof value !== 'object') cell.value = value;
      else if ('r' in value) cell.value = { richText: value.r };
      else cell.value = { formula: totalFormula(r, value.f), result: results.get(cell.address) } as ExcelJS.CellFormulaValue;
    }
  }

  for (const [addr, rule] of Object.entries(spec.dataValidations)) ws.getCell(addr).dataValidation = rule;

  ws.getCell('B2').value = week.title;
  ws.getCell('B7').value = monthOf(week.days[0]);
  ws.getCell('C7').value = dayOf(week.days[0]);
  for (const i of literalDays) ws.getCell(`C${7 + i}`).value = 1;
  ws.getCell('D4').value = settings.minStandard;
  ws.getCell('U4').value = settings.targetRatio;
  ws.getCell('D20').value = settings.minStandard;
  ws.getCell('U20').value = settings.targetRatio;

  const set = (addr: string, v: string | number | null | undefined) => {
    if (v !== null && v !== undefined && v !== '') ws.getCell(addr).value = v;
  };

  sheet.lines.forEach((block, li) => {
    const layout = WEEKLY_LAYOUT[li];
    block.rows.forEach((row, i) => {
      const r = layout.topRow + i;
      const e = entries[dayKey(row.date, block.line)] ?? EMPTY_DAY_ENTRY;
      set(`E${r}`, e.shift_type);
      set(`F${r}`, e.work_hours);
      set(`G${r}`, e.barcode_qty);
      for (const c of CREW_COLUMNS) set(`${c.col}${r}`, (e.crew[c.key] ?? '').trim());
      set(`AE${r}`, e.reason);
      // 맨 아래 칸 — 여기를 고치면 위 표가 바뀐다
      const base = layout.bottomRow + i * 3;
      set(`H${base}`, row.double.jo || null);
      set(`K${base}`, row.double.m2 || null);
      set(`H${base + 1}`, row.triple.jo || null);
      set(`K${base + 1}`, row.triple.m2 || null);
    });
  });

  // 바코드 입력 비율 — 양식 수식을 IFERROR 로만 감쌌다
  for (const layout of WEEKLY_LAYOUT) {
    for (let r = layout.topRow; r < layout.topRow + 6; r++) {
      ws.getCell(`H${r}`).value = { formula: `IFERROR((G${r}/U${r})*100,"")`, result: results.get(`H${r}`) ?? '' } as ExcelJS.CellFormulaValue;
    }
  }

  const image = wb.addImage({ base64: spec.approval.png, extension: 'png' });
  for (const a of APPROVAL_ANCHORS) ws.addImage(image, { ...a, editAs: 'twoCell' } as unknown as ExcelJS.ImageRange);
  return ws;
}

/**
 * 엑셀이 받는 시트 이름으로 — / \ ? * [ ] : 는 못 쓰고(exceljs 가 오류를 던져 주간 엑셀 전체가 안 나왔다),
 * 31자까지, 앞뒤 작은따옴표 불가, 대소문자 무시하고 겹치면 안 된다 (2026-11-10 점검 — 호기 이름은 사람이 짓는다)
 */
export function safeSheetName(raw: string, used: Iterable<string>): string {
  const base = raw.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').replace(/^'+|'+$/g, '').trim() || '시트';
  const taken = new Set([...used].map(n => n.toLowerCase()));
  let name = base.slice(0, 31).trim();
  for (let k = 2; taken.has(name.toLowerCase()); k++) {
    const suffix = ` (${k})`;
    name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
  }
  return name;
}

/** 한 주 파일 — 1 · 2호기 시트 + 기록이 있는 더한 호기 시트 (두 호기씩) */
export function buildWeeklyWorkbook(
  sheet: WeeklySheet, entries: Record<string, WeeklyDayEntry | undefined>, settings?: WeeklySettings,
  nameOf: (line: number) => string = line => `${line}호기`,
): ExcelJS.Workbook {
  const wb = newWorkbook();
  const [first, second, ...rest] = sheet.lines;
  addWeeklySheet(wb, { ...sheet, lines: [first, second] }, entries, settings);
  const extras = rest.filter(lineHasData);
  for (let i = 0; i < extras.length; i += 2) {
    const pair = extras.slice(i, i + 2);
    const names = pair.map(b => nameOf(b.line));
    const name = safeSheetName(`${sheet.week.sheetName} ${names.join(' ')}`, wb.worksheets.map(w => w.name));
    const ws = addWeeklySheet(wb, { ...sheet, lines: pair }, entries, settings, name);
    pair.forEach((_, k) => nameBlock(ws, k, names[k]));
    if (pair.length === 1) hideSecondBlock(ws);
  }
  return wb;
}
