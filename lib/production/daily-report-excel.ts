/**
 * 일간 생산일지 엑셀.
 *
 *  ① 생산일지 — 날짜 띠 아래에 그날 만든 품목, 날짜마다 소계, 맨 끝에 총계
 *  ② 일별 합계 — 기간의 모든 날짜를 한 줄씩 (생산이 없던 날도 0 으로 남겨 빈 날이 보이게)
 *
 * 사무실에서 출력해 보는 문서라 A4 가로 한 장 폭에 맞추고, 머리글 행은 매 쪽 반복한다.
 * 서식이 필요해 xlsx(SheetJS) 대신 exceljs 를 쓴다.
 */
import ExcelJS from 'exceljs';
import { daysBetween, weekdayOf, type DailyReport } from './daily-report';

const FONT = 'Malgun Gothic';
const NAVY = 'FF1F3A5F';
const BAND = 'FFE8EEF6';
const SUBTOTAL = 'FFF4F6F9';
const GRID = 'FFC9D1DC';

const thin = { style: 'thin' as const, color: { argb: GRID } };
const box: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };

const DETAIL_COLUMNS = [
  { header: 'No', width: 5 },
  { header: '의뢰번호', width: 11 },
  { header: '거래처', width: 16 },
  { header: '현장', width: 22 },
  { header: '품명', width: 34 },
  { header: '가로', width: 8 },
  { header: '세로', width: 8 },
  { header: '수량(장)', width: 9 },
  { header: '면적(㎡)', width: 10 },
  { header: '주/야', width: 7 },
  { header: '호기', width: 7 },
  { header: '입력자', width: 10 },
];

export async function buildDailyReportWorkbook(report: DailyReport, printedAt: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DG-Flow';
  addDetailSheet(wb, report, printedAt);
  addSummarySheet(wb, report, printedAt);
  return wb;
}

function addDetailSheet(wb: ExcelJS.Workbook, report: DailyReport, printedAt: string) {
  const ws = wb.addWorksheet('생산일지', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: '&C&P / &N' },
  });
  const last = DETAIL_COLUMNS.length;
  ws.columns = DETAIL_COLUMNS.map(c => ({ width: c.width }));

  title(ws, last, '일간 생산일지', `기간 ${report.from} ~ ${report.to}  ·  출력 ${printedAt}`);

  const header = ws.addRow(DETAIL_COLUMNS.map(c => c.header));
  styleHeader(header, last);
  const headerRow = header.number;
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;

  if (report.days.length === 0) {
    const r = ws.addRow(['이 기간에 입력된 생산실적이 없습니다.']);
    ws.mergeCells(r.number, 1, r.number, last);
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(1).font = { name: FONT, size: 10, color: { argb: 'FF6B7280' } };
    r.height = 28;
    return;
  }

  for (const day of report.days) {
    // 날짜 띠 — 그날의 요약을 한 줄에
    const band = ws.addRow([
      `${day.date} (${day.weekday})     생산 ${day.quantity.toLocaleString()}장  ·  ${day.area_m2.toFixed(2)}㎡  ·  작업의뢰서 ${day.work_order_count}건`,
    ]);
    ws.mergeCells(band.number, 1, band.number, last);
    band.height = 22;
    const bc = band.getCell(1);
    bc.font = { name: FONT, size: 11, bold: true, color: { argb: NAVY } };
    bc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    bc.alignment = { vertical: 'middle', indent: 1 };
    bc.border = box;

    day.lines.forEach((l, i) => {
      const r = ws.addRow([
        i + 1, l.work_order_number, l.customer, l.site, l.product_name,
        l.width_mm ?? '', l.height_mm ?? '', l.quantity, l.area_m2,
        l.shift === 'night' ? '야간' : '주간', `${l.line_number}호기`, l.workers.join(', '),
      ]);
      styleBody(r, last);
    });

    const sub = ws.addRow(['', '', '', '', `${day.date} 소계`, '', '', day.quantity, day.area_m2, '', '', '']);
    styleTotal(sub, last, SUBTOTAL);
  }

  ws.addRow([]);
  const total = ws.addRow(['', '', '', '',
    `기간 총계  (${report.days.length}일 생산)`, '', '', report.quantity, report.area_m2, '', '', '']);
  styleTotal(total, last, 'FFDCE5F0', true);
}

function addSummarySheet(wb: ExcelJS.Workbook, report: DailyReport, printedAt: string) {
  const ws = wb.addWorksheet('일별 합계', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const cols = [
    { header: '날짜', width: 13 }, { header: '요일', width: 6 }, { header: '작업의뢰서', width: 11 },
    { header: '주간(장)', width: 10 }, { header: '야간(장)', width: 10 },
    { header: '생산 수량(장)', width: 13 }, { header: '면적(㎡)', width: 12 },
  ];
  const last = cols.length;
  ws.columns = cols.map(c => ({ width: c.width }));

  title(ws, last, '일별 생산 합계', `기간 ${report.from} ~ ${report.to}  ·  출력 ${printedAt}`);
  const header = ws.addRow(cols.map(c => c.header));
  styleHeader(header, last);
  ws.views = [{ state: 'frozen', ySplit: header.number }];

  // 생산이 없던 날도 줄을 남긴다 — 빠진 날이 눈에 띄어야 입력 누락을 잡는다
  const byDate = new Map(report.days.map(d => [d.date, d]));
  const n = daysBetween(report.from, report.to);
  for (let i = 0; i < n; i++) {
    const date = addDays(report.from, i);
    const d = byDate.get(date);
    const r = ws.addRow([
      date, weekdayOf(date), d?.work_order_count ?? 0, d?.day_quantity ?? 0, d?.night_quantity ?? 0,
      d?.quantity ?? 0, d?.area_m2 ?? 0,
    ]);
    styleBody(r, last, { center: [1, 2, 3] });
    if (!d) r.eachCell(c => { c.font = { name: FONT, size: 10, color: { argb: 'FFA0A7B4' } }; });
    const wd = weekdayOf(date);
    if (wd === '일') r.getCell(2).font = { name: FONT, size: 10, color: { argb: 'FFC0392B' } };
    if (wd === '토') r.getCell(2).font = { name: FONT, size: 10, color: { argb: 'FF2E6DB4' } };
  }

  const total = ws.addRow(['합계', '', '',
    report.days.reduce((s, d) => s + d.day_quantity, 0),
    report.days.reduce((s, d) => s + d.night_quantity, 0),
    report.quantity, report.area_m2]);
  styleTotal(total, last, 'FFDCE5F0', true);
}

/* ── 서식 ─────────────────────────────────────────── */

function title(ws: ExcelJS.Worksheet, last: number, text: string, sub: string) {
  const t = ws.addRow([text]);
  ws.mergeCells(t.number, 1, t.number, last);
  t.height = 30;
  t.getCell(1).font = { name: FONT, size: 16, bold: true, color: { argb: NAVY } };
  t.getCell(1).alignment = { vertical: 'middle' };

  const s = ws.addRow([sub]);
  ws.mergeCells(s.number, 1, s.number, last);
  s.getCell(1).font = { name: FONT, size: 10, color: { argb: 'FF4B5563' } };
  ws.addRow([]);
}

function styleHeader(row: ExcelJS.Row, last: number) {
  row.height = 22;
  for (let c = 1; c <= last; c++) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = box;
  }
}

/** 숫자 열(수량·면적·규격)은 오른쪽, 지정한 열은 가운데 */
function styleBody(row: ExcelJS.Row, last: number, opt: { center?: number[] } = {}) {
  row.height = 18;
  for (let c = 1; c <= last; c++) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, size: 10 };
    cell.border = box;
    cell.alignment = { vertical: 'middle' };
    if (typeof cell.value === 'number') {
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.numFmt = Number.isInteger(cell.value) && !isAreaColumn(row, c) ? '#,##0' : '#,##0.00';
    }
    if (opt.center?.includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  // 생산일지: No · 주야 · 호기 가운데, 거래처·현장·품명은 길면 줄을 바꾼다 (행 높이는 엑셀이 맞춘다)
  if (last === DETAIL_COLUMNS.length) {
    row.height = undefined as unknown as number;
    for (const c of [1, 2, 10, 11]) row.getCell(c).alignment = { vertical: 'middle', horizontal: 'center' };
    for (const c of [3, 4, 5]) row.getCell(c).alignment = { vertical: 'middle', wrapText: true };
    row.getCell(9).numFmt = '#,##0.00';
  }
}

function isAreaColumn(row: ExcelJS.Row, c: number) {
  const ws = row.worksheet;
  // 일별 합계 시트의 마지막 열과 생산일지의 9열이 면적
  return (ws.name === '일별 합계' && c === 7) || (ws.name === '생산일지' && c === 9);
}

function styleTotal(row: ExcelJS.Row, last: number, fill: string, strong = false) {
  row.height = strong ? 22 : 19;
  for (let c = 1; c <= last; c++) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, size: strong ? 11 : 10, bold: true, color: { argb: strong ? NAVY : 'FF1F2937' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.border = box;
    cell.alignment = { vertical: 'middle', horizontal: typeof cell.value === 'number' ? 'right' : 'left' };
    if (typeof cell.value === 'number') cell.numFmt = isAreaColumn(row, c) ? '#,##0.00' : '#,##0';
  }
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
