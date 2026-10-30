import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  buildBokcheungRange, buildBokcheungSheet, parseProductName, suggestQuantityNote, summarizeTypes, rowKey,
  type BokcheungEntry, type BokcheungRow, type BokcheungSheet,
} from '@/lib/production/bokcheung';
import { buildBokcheungRangeWorkbook, buildBokcheungWorkbook, bokcheungLayout } from '@/lib/production/bokcheung-excel';
import type { ProductionLogRow } from '@/lib/production/daily-report';
import template from '@/lib/production/bokcheung-template.json';

/**
 * 복층생산일지 — 2026-10-30 사용자 요청 "일간 생산일지를 회사 복층생산일지 그대로, 종류 · 수량외만 입력".
 * 실물: 엑셀 자료/복층생산일지(2026).xlsx (회사 파일, 저장소에 안 올림) 의 5월 16일 시트.
 */

describe('품명 → 재료종류 · 두께 · AR', () => {
  it('ERP 품명의 앞 두께 표기를 떼고, 간봉 자리의 Ar 을 본다', () => {
    expect(parseProductName('24T 5SKN176IIh/s+14단열(Ar.)+5CLh/s'))
      .toEqual({ composition: '5SKN176IIh/s+14단열(Ar.)+5CLh/s', thickness: 24, argon: true, insulated: true });
    expect(parseProductName('22T 5newGN+12AR.+5로이')).toMatchObject({ thickness: 22, argon: true });
    // 12A 는 공기, 12단열(S) 도 아르곤이 아니다 — 회사 시트에서 AR 칸이 비어 있던 줄
    expect(parseProductName('22T 5newGN+12A+5로이')).toMatchObject({ argon: false });
    expect(parseProductName('5CL+12단열(S)+5로이')).toMatchObject({ argon: false, thickness: 22 });
  });

  it('앞 표기가 없으면 재료 숫자를 더하고, 3복층도 읽는다', () => {
    expect(parseProductName('5CL+12Ar.+5DURA MAX')).toMatchObject({ thickness: 22, argon: true });
    expect(parseProductName('5로이+12단열(Ar.)+5CLh/s+12단열(Ar.)+5CL')).toMatchObject({ thickness: 39, argon: true });
  });

  it('단판(10T 투명강화)은 복층이 아니다', () => {
    expect(parseProductName('10T 투명강화')).toMatchObject({ insulated: false, argon: false });
  });
});

describe('수량외 제안 · 종류별 합계', () => {
  it('"16조외52" — 앞 크기 수량 + 나머지, 한 크기뿐이면 수만', () => {
    expect(suggestQuantityNote(16, 68)).toBe('16조외52');
    expect(suggestQuantityNote(1, 1)).toBe('1');
    expect(suggestQuantityNote(5, 5)).toBe('5');
  });
});

const log = (o: Partial<ProductionLogRow>): ProductionLogRow => ({
  production_date: '2026-10-30', quantity_completed: 1, area_m2: 1, shift: 'day', line_number: 1,
  work_order_id: 'wo-a', work_order_item_id: 'item-1', work_order_number: '26-0101',
  customer: '가나건설(주)', site: '가나 현장', product_name: '22T 5CL+12Ar.+5로이',
  width_mm: 763, height_mm: 955, sort_order: 0, created_by_name: null, ...o,
});

describe('생산 기록 → 복층생산일지 줄', () => {
  const logs: ProductionLogRow[] = [
    // 26-0101 · 1호기 · 같은 재료 두 품목(뒤 순서 품목을 먼저 저장) + 다른 재료 한 품목
    log({ work_order_item_id: 'item-2', width_mm: 463, sort_order: 1, quantity_completed: 4, area_m2: 1.77 }),
    log({ work_order_item_id: 'item-1', width_mm: 763, sort_order: 0, quantity_completed: 2, area_m2: 1.46 }),
    log({ work_order_item_id: 'item-1', width_mm: 763, sort_order: 0, quantity_completed: 2, area_m2: 1.46 }),
    log({ work_order_item_id: 'item-3', product_name: '22T 5newGN+12A+5로이', width_mm: 702, height_mm: 1759, sort_order: 2, quantity_completed: 4, area_m2: 4.94 }),
    // 26-0050 · 1호기 — 주문번호가 앞이라 위로 온다
    log({ work_order_id: 'wo-b', work_order_number: '26-0050', customer: '다라창호', site: '', work_order_item_id: 'item-9', product_name: '16T 5newGN+6A+5CL', width_mm: 663, height_mm: 1490, quantity_completed: 1, area_m2: 0.99 }),
    // 2호기
    log({ line_number: 2, work_order_id: 'wo-c', work_order_number: '26-0301', work_order_item_id: 'item-7', product_name: '24T 5SKN154IIh/s+14단열(Ar.)+5CLh/s', width_mm: 1135, height_mm: 1380, quantity_completed: 2, area_m2: 3.13 }),
    // 단판 · 다른 날짜 — 빠진다
    log({ work_order_item_id: 'item-5', product_name: '10T 투명강화', quantity_completed: 3 }),
    log({ production_date: '2026-10-29', quantity_completed: 50 }),
  ];
  const sheet = buildBokcheungSheet(logs, '2026-10-30', { quantity: 100, area_m2: 10 });

  it('호기별 두 덩어리, 주문번호 순, 같은 주문 두 번째 재료 줄은 주문번호를 비운다', () => {
    const [b1, b2] = sheet.blocks;
    expect(b1.rows.map(r => [r.work_order_number, r.composition, r.continued])).toEqual([
      ['26-0050', '5newGN+6A+5CL', false],
      ['26-0101', '5CL+12Ar.+5로이', false],
      ['26-0101', '5newGN+12A+5로이', true],
    ]);
    expect(b2.rows.map(r => r.work_order_number)).toEqual(['26-0301']);
    expect(b1.quantity).toBe(1 + 8 + 4);
    expect(b2.area_m2).toBe(3.13);
  });

  it('가로 · 세로는 그날 그 줄에서 작업의뢰서 순서가 가장 앞인 품목, 수량외 제안은 그 품목 수량 기준', () => {
    const r = sheet.blocks[0].rows[1];
    expect([r.width_mm, r.height_mm, r.lead_quantity, r.quantity]).toEqual([763, 955, 4, 8]);
    expect(r.suggested_note).toBe('4조외4');
    expect(r.thickness).toBe(22);
    expect(r.argon).toBe(true);
    expect(r.area_m2).toBe(4.69);
    expect(r.customer_site).toBe('가나건설(주) 가나 현장');
  });

  it('복층이 아닌 품목은 빼고 따로 알려 준다', () => {
    expect(sheet.excluded).toEqual({ quantity: 3, names: ['10T 투명강화'] });
  });

  it('종류별 합계는 회사 수식처럼 — B종(U3-2) 칸이 "U3" 를 센다, 대소문자 무시', () => {
    const entries: Record<string, BokcheungEntry> = {
      [sheet.blocks[0].rows[0].key]: { glass_type: 'u1', quantity_note: '' },
      [sheet.blocks[0].rows[1].key]: { glass_type: 'U3', quantity_note: '' },
      [sheet.blocks[1].rows[0].key]: { glass_type: 'U3-1', quantity_note: '' },
    };
    const { counts, total } = summarizeTypes(sheet, entries);
    expect(counts).toEqual([1, 0, 2, 8, 0]);
    expect(total).toBe(11);
  });
});

/* ── 회사 5월 16일 시트와 칸마다 대조 ── */

const FIXTURE = path.join(process.cwd(), '엑셀 자료', '복층생산일지(2026).xlsx');
const hasFixture = fs.existsSync(FIXTURE);

/** 회사 시트의 테마 색 → 실제 색 (설계도를 만들 때와 같은 계산) */
function tinted(hex: string, tint = 0): string {
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const rgb = s === 0 ? [l, l, l] : [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  return rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
type Color = { argb?: string; theme?: number; tint?: number } | undefined;
const argb = (c: Color) => c?.argb ?? (c?.theme !== undefined ? 'FF' + tinted((template as { theme: string[] }).theme[c.theme], c.tint ?? 0) : undefined);
/** 비교용 서식 — 글꼴 이름 · 크기 · 굵기, 네 변 테두리, 채우기 색, 정렬, 숫자 형식 */
function look(cell: ExcelJS.Cell) {
  const s = cell.style ?? {};
  const fill = s.fill && s.fill.type === 'pattern' && s.fill.pattern && s.fill.pattern !== 'none'
    ? `${s.fill.pattern}:${argb(s.fill.fgColor as Color)}` : '';
  return JSON.stringify([
    s.font?.name, s.font?.size, !!s.font?.bold,
    ...(['top', 'left', 'bottom', 'right'] as const).map(k => s.border?.[k]?.style ?? ''),
    fill, s.alignment?.horizontal ?? '', s.alignment?.vertical ?? '', !!s.alignment?.wrapText, s.numFmt ?? '',
  ]);
}
const plain = (v: ExcelJS.CellValue) => {
  // 수식은 계산 결과로 본다. 회사 파일의 빈 줄은 공유 수식(K9 를 따라감)이라 결과가 안 적혀 있다 — 빈 줄은 0
  if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) return (v as { result?: unknown }).result ?? 0;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v ?? null;
};

/** 회사 5월 16일 시트의 줄을 우리 모양으로 옮긴다 — 같은 내용을 넣으면 같은 엑셀이 나와야 한다 */
function sheetFromCompany(ws: ExcelJS.Worksheet) {
  const entries: Record<string, BokcheungEntry> = {};
  const rowsOf = (from: number, to: number, line: number) => {
    const rows: BokcheungRow[] = [];
    let order = '', customer = '';
    for (let r = from; r <= to; r++) {
      const v = (c: string) => plain(ws.getCell(`${c}${r}`).value);
      if (v('D') == null) continue;
      const continued = v('A') == null;
      if (!continued) { order = String(v('A')); customer = String(v('B')); }
      const key = rowKey(line, `${order}#${r}`, String(v('D')));
      entries[key] = { glass_type: String(v('C') ?? ''), quantity_note: String(v('I') ?? '') };
      rows.push({
        key, line, work_order_id: order, work_order_number: order, customer_site: customer,
        composition: String(v('D')), thickness: v('E') as number, argon: v('F') === 'AR',
        width_mm: v('G') as number, height_mm: v('H') as number, lead_quantity: 0,
        quantity: v('J') as number, area_m2: v('M') as number, continued, suggested_note: '',
      });
    }
    return rows;
  };
  const block = (rows: BokcheungRow[], line: number) => ({
    line, name: `${line}호기`, rows, quantity: rows.reduce((s, r) => s + r.quantity, 0), area_m2: rows.reduce((s, r) => s + r.area_m2, 0),
  });
  const sheet: BokcheungSheet = {
    date: '2026-05-16',
    blocks: [block(rowsOf(8, 23, 1), 1), block(rowsOf(25, 40, 2), 2)],
    excluded: { quantity: 0, names: [] },
    cumulative: { quantity: 13876, area_m2: 146744.37 / 10.89 },
  };
  return { sheet, entries };
}

describe.skipIf(!hasFixture)('회사 복층생산일지 5월 16일 시트와 같은가', async () => {
  const company = new ExcelJS.Workbook();
  await company.xlsx.readFile(FIXTURE);
  const ws0 = company.getWorksheet('5월  16일')!;
  const { sheet, entries } = sheetFromCompany(ws0);
  const ours = new ExcelJS.Workbook();
  await ours.xlsx.load(await buildBokcheungWorkbook(sheet, entries).xlsx.writeBuffer());
  const ws1 = ours.worksheets[0];
  const COLS = 'ABCDEFGHIJKLMN'.split('');

  it('1~45행 모든 칸의 서식이 같다 (글꼴 · 테두리 · 채우기 · 정렬 · 숫자 형식)', () => {
    const diffs: string[] = [];
    for (let r = 1; r <= 45; r++) for (const c of COLS) {
      const a = look(ws0.getCell(`${c}${r}`)), b = look(ws1.getCell(`${c}${r}`));
      if (a !== b) diffs.push(`${c}${r} 회사${a} 우리${b}`);
    }
    expect(diffs).toEqual([]);
  });

  it('값이 같다 — 누계까지', () => {
    const diffs: string[] = [];
    for (let r = 1; r <= 45; r++) for (const c of COLS) {
      const cell0 = ws0.getCell(`${c}${r}`), cell1 = ws1.getCell(`${c}${r}`);
      if (cell0.isMerged && cell0.master.address !== cell0.address) continue; // 병합의 딸린 칸
      let a = plain(cell0.value), b = plain(cell1.value);
      if (typeof a === 'number' && typeof b === 'number') { a = Math.round(a * 100) / 100; b = Math.round(b * 100) / 100; }
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${c}${r} 회사=${JSON.stringify(a)} 우리=${JSON.stringify(b)}`);
    }
    expect(diffs).toEqual([]);
  });

  it('수식이 같다 — 면적 ㎡×10.89, 소계 SUM, 종류별 SUMIF', () => {
    expect(ws1.getCell('K8').formula).toBe('+M8*N8');
    expect(ws1.getCell('K23').formula).toBe('+M23*N23');
    expect(ws1.getCell('J24').formula).toBe(ws0.getCell('J24').formula);
    expect(ws1.getCell('K41').formula).toBe(ws0.getCell('K41').formula);
    for (const c of ['A', 'B', 'C', 'E', 'H', 'J']) expect(ws1.getCell(`${c}44`).formula).toBe(ws0.getCell(`${c}44`).formula);
  });

  it('병합 · 칸 너비 · 줄 높이 · 인쇄 설정이 같다', () => {
    expect(new Set(ws1.model.merges)).toEqual(new Set(ws0.model.merges));
    for (let i = 1; i <= 14; i++) expect(ws1.getColumn(i).width).toBeCloseTo(ws0.getColumn(i).width!, 5);
    for (let r = 1; r <= 45; r++) expect(ws1.getRow(r).height).toBe(ws0.getRow(r).height);
    for (const k of ['paperSize', 'orientation', 'scale', 'horizontalCentered', 'printArea'] as const) {
      expect(ws1.pageSetup[k]).toEqual(ws0.pageSetup[k]);
    }
    expect(ws1.pageSetup.margins).toEqual(ws0.pageSetup.margins);
  });
});

describe('주문이 16줄을 넘는 날', () => {
  it('덩어리 줄이 늘고, 소계 · 합계 범위와 아래 병합이 따라 내려간다', async () => {
    const rows: BokcheungRow[] = Array.from({ length: 20 }, (_, i) => ({
      key: `1|wo${i}|5CL+12Ar.+5로이`, line: 1, work_order_id: `wo${i}`, work_order_number: `26-${1000 + i}`,
      customer_site: '업체 현장', composition: '5CL+12Ar.+5로이', thickness: 22, argon: true,
      width_mm: 700, height_mm: 900, lead_quantity: 1, quantity: 1, area_m2: 0.63, continued: false, suggested_note: '1',
    }));
    const sheet: BokcheungSheet = {
      date: '2026-10-30',
      blocks: [{ line: 1, name: '1호기', rows, quantity: 20, area_m2: 12.6 }, { line: 2, name: '2호기', rows: [], quantity: 0, area_m2: 0 }],
      excluded: { quantity: 0, names: [] }, cumulative: { quantity: 0, area_m2: 0 },
    };
    const L = bokcheungLayout(sheet);
    expect(L).toMatchObject({ start1: 8, sub1: 28, start2: 29, sub2: 45, tail: 46, last: 49 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildBokcheungWorkbook(sheet, {}).xlsx.writeBuffer());
    const ws = wb.worksheets[0];
    expect(ws.getCell('J28').formula).toBe('SUM(J8:J27)');
    expect(ws.getCell('A27').value).toBe('26-1019');
    expect(ws.getCell('A48').formula).toBe('SUMIF($C$8:$C$46,"U1",$J$8:$J$46)');
    expect(ws.model.merges).toContain('J49:L49');
    expect(ws.pageSetup.printArea).toBe('A1:L49');
  });
});

describe('기간 — 날짜별 시트 (회사 파일처럼 하루 한 장)', () => {
  const day = (date: string, o: Partial<ProductionLogRow> = {}) => log({ production_date: date, ...o });
  const logs: ProductionLogRow[] = [
    day('2026-10-27', { quantity_completed: 5, area_m2: 2 }),
    day('2026-10-28', { product_name: '10T 투명강화', quantity_completed: 9 }), // 단판만 있는 날 — 시트 없음
    day('2026-10-29', { quantity_completed: 3, area_m2: 1.5 }),
    day('2026-10-30', { quantity_completed: 4, area_m2: 1 }),
    day('2026-10-30', { line_number: 2, work_order_item_id: 'item-8', quantity_completed: 1, area_m2: 0.5 }),
  ];

  it('복층이 있는 날만, 날짜마다 그해 누계가 쌓인다 (기간 앞 기록도 누계에 든다)', () => {
    const sheets = buildBokcheungRange(logs, '2026-10-28', '2026-10-30');
    expect(sheets.map(s => s.date)).toEqual(['2026-10-29', '2026-10-30']);
    expect(sheets.map(s => s.cumulative)).toEqual([
      { quantity: 8, area_m2: 3.5 },
      { quantity: 13, area_m2: 5 },
    ]);
    expect(sheets[1].blocks.map(b => b.quantity)).toEqual([4, 1]);
  });

  it('해가 바뀌면 누계를 새로 센다', () => {
    const sheets = buildBokcheungRange([day('2026-12-31', { quantity_completed: 7 }), day('2027-01-02', { quantity_completed: 2 })], '2026-12-31', '2027-01-02');
    expect(sheets.map(s => s.cumulative.quantity)).toEqual([7, 2]);
  });

  it('엑셀은 날짜순 시트, 시트마다 회사 양식 그대로 (날짜 · 인쇄 범위 · 병합)', async () => {
    const sheets = buildBokcheungRange(logs, '2026-10-01', '2026-10-31');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildBokcheungRangeWorkbook(sheets.reverse().map(sheet => ({ sheet, entries: {} }))).xlsx.writeBuffer());
    expect(wb.worksheets.map(w => w.name)).toEqual(['10월 27일', '10월 29일', '10월 30일']);
    for (const ws of wb.worksheets) {
      expect(ws.pageSetup.printArea).toBe('A1:L45');
      expect(ws.model.merges).toHaveLength(26);
      expect(ws.getCell('A1').value).toBe('(복층유리) 생산일지');
    }
    expect((wb.worksheets[2].getCell('B5').value as Date).toISOString().slice(0, 10)).toBe('2026-10-30');
  });

  it('같은 시트 이름이 또 나오면 연도를 붙인다', async () => {
    const a = buildBokcheungRange([day('2026-01-03')], '2026-01-03', '2026-01-03')[0];
    const b = buildBokcheungRange([day('2027-01-03')], '2027-01-03', '2027-01-03')[0];
    const wb = buildBokcheungRangeWorkbook([{ sheet: a, entries: {} }, { sheet: b, entries: {} }]);
    expect(wb.worksheets.map(w => w.name)).toEqual(['1월 3일', '1월 3일 (2027)']);
  });
});

describe('호기를 더했을 때 (미니라인 등)', () => {
  const lines = [
    { line_number: 1, name: '1호기', sort_order: 1, is_active: true },
    { line_number: 2, name: '2호기', sort_order: 2, is_active: true },
    { line_number: 3, name: '미니라인', sort_order: 3, is_active: true },
  ];
  const logs = [
    log({ quantity_completed: 2, area_m2: 1 }),
    log({ line_number: 3, work_order_item_id: 'item-3', quantity_completed: 5, area_m2: 2 }),
  ];

  it('1 · 2호기 덩어리는 늘 있고, 더한 호기는 생산이 있는 날만 이름과 함께 덧붙는다', () => {
    const sheet = buildBokcheungSheet(logs, '2026-10-30', { quantity: 0, area_m2: 0 }, lines);
    expect(sheet.blocks.map(b => [b.line, b.name, b.rows.length])).toEqual([[1, '1호기', 1], [2, '2호기', 0], [3, '미니라인', 1]]);
    const none = buildBokcheungSheet([logs[0]], '2026-10-30', { quantity: 0, area_m2: 0 }, lines);
    expect(none.blocks.map(b => b.line)).toEqual([1, 2]);
  });

  it('엑셀 — 셋째 덩어리는 쓴 줄만큼, 합계 수식은 마지막 덩어리까지', async () => {
    const sheet = buildBokcheungSheet(logs, '2026-10-30', { quantity: 0, area_m2: 0 }, lines);
    const L = bokcheungLayout(sheet);
    expect(L.blocks[2]).toEqual({ start: 42, n: 1, sub: 43 });
    expect(L).toMatchObject({ tail: 44, last: 47 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildBokcheungWorkbook(sheet, {}).xlsx.writeBuffer());
    const ws = wb.worksheets[0];
    expect(ws.getCell('J43').formula).toBe('SUM(J42:J42)');
    expect(ws.getCell('J43').value).toMatchObject({ result: 5 });
    expect(ws.getCell('A46').formula).toBe('SUMIF($C$8:$C$44,"U1",$J$8:$J$44)');
    expect(ws.pageSetup.printArea).toBe('A1:L47');
  });
});
