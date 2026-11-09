import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  autoOutputs, buildWeeklySheet, crewTotal, dayKey, gradeOf, isTriple, weekOf, weeklyLineNumbers,
  DEFAULT_SETTINGS, EMPTY_DAY_ENTRY, type WeeklyDayEntry,
} from '@/lib/production/weekly';
import { buildWeeklyWorkbook, WEEKLY_LAYOUT } from '@/lib/production/weekly-excel';
import { cleanEntries } from '@/lib/production/weekly-store';
import { glassParts } from '@/lib/production/bokcheung';
import type { ProductionLogRow } from '@/lib/production/daily-report';
import template from '@/lib/production/weekly-template.json';

/**
 * 주간생산일지 — 2026-11-06 사용자 요청 "시스템에서 작성하고 엑셀도 양식 그대로, 맨 아래를 고치면 위가 바뀌게".
 * 실물: 카카오톡 받은 파일 주간생산일지(2026).xlsx (회사 파일, 저장소에 안 올림) 의 1031 시트 값으로 대조.
 */

const log = (o: Partial<ProductionLogRow>): ProductionLogRow => ({
  production_date: '2026-10-26', quantity_completed: 1, area_m2: 1, shift: 'day', line_number: 1,
  work_order_id: 'wo', work_order_item_id: 'item', work_order_number: '26-0001', customer: null, site: null,
  product_name: '22T 5CL+12A+5로이', width_mm: 1000, height_mm: 1000, sort_order: 0, created_by_name: null, ...o,
});
const day = (o: Partial<WeeklyDayEntry>): WeeklyDayEntry => ({ ...EMPTY_DAY_ENTRY, ...o });

describe('주차 표기 — 회사 시트 제목과 같게', () => {
  it.each([
    ['2026-10-26', ' 2026년 44주차  ( 10월  5주)', '1031'],
    ['2026-10-29', ' 2026년 44주차  ( 10월  5주)', '1031'],
    ['2026-09-28', ' 2026년 40주차  ( 10월  1주)', '1003'], // 달이 걸치면 목요일이 있는 달
    ['2026-04-27', ' 2026년 18주차  ( 4월  5주)', '0502'],
    ['2026-08-03', ' 2026년 32주차  ( 8월  2주)', '0808'], // 8/1 이 앞 주에 있어 둘째 주
    ['2026-08-31', ' 2026년 36주차  ( 9월  1주)', '0905'],
    ['2026-02-02', ' 2026년 6주차  ( 2월  1주)', '0207'],  // 2/1 이 일요일 — 첫 근무일이 든 주가 1주
    ['2026-06-29', ' 2026년 27주차  ( 7월  1주)', '0704'],
  ])('%s → %s', (date, title, sheetName) => {
    expect(weekOf(date)).toMatchObject({ title, sheetName });
  });

  it('일요일은 그 주 월요일로 간다 — 한 주 = 월–토', () => {
    const w = weekOf('2026-11-01');
    expect(w.monday).toBe('2026-10-26');
    expect(w.days).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  });
});

describe('복층 · 3복층 나누기', () => {
  it('유리 3장(5겹 이상)이 3복층이다 — 접합 유리의 괄호 안 + 는 겹이 아니다', () => {
    expect(isTriple('39T 5로이+12단열(Ar.)+5CLh/s+12단열(Ar.)+5CL')).toBe(true);
    expect(isTriple('8.76투명접합+14Ar.+5로이h/s+14Ar.+5로이')).toBe(true);
    expect(isTriple('22T 5CL+12A+5로이')).toBe(false);
    expect(isTriple('8.76(4cl+0.76+4cl)접합+12A+5로이')).toBe(false);
    expect(isTriple('7.76태양광(4CL+0.76+3CL)접합+14A+5라미')).toBe(false);
    expect(glassParts('8.76(4cl+0.76+4cl)접합+12A+5로이')).toHaveLength(3);
  });

  it('날짜 · 호기별로 조 · M2 를 나눠 더하고, 단판은 뺀다', () => {
    const a = autoOutputs([
      log({ quantity_completed: 10, area_m2: 12.5 }),
      log({ quantity_completed: 5, area_m2: 2.25 }),
      log({ quantity_completed: 3, area_m2: 4, product_name: '5로이+12A+5CL+12A+5CL' }),
      log({ quantity_completed: 7, area_m2: 7, line_number: 2 }),
      log({ quantity_completed: 99, area_m2: 99, product_name: '10T 투명강화' }),
    ]);
    expect(a['2026-10-26'][1]).toEqual({ double: { jo: 15, m2: 14.75 }, triple: { jo: 3, m2: 4 } });
    expect(a['2026-10-26'][2].double).toEqual({ jo: 7, m2: 7 });
  });
});

describe('계산 — 회사 1031 시트 값과 대조', () => {
  // 1호기 10/26: 주간연장 11시간, 복층 405조 · 576.69㎡
  const entries = {
    [dayKey('2026-10-26', 1)]: day({
      shift_type: '주간연장', work_hours: 11, barcode_qty: 231,
      crew: { feed: 'a', marking: 'b', finish1: 'c', spacer2: 'd', spacer3: 'e', butyl: 'f', spacerCut: 'g', banding: 'h' },
      double_jo: 405, double_m2: 576.69,
    }),
    [dayKey('2026-10-27', 1)]: day({ shift_type: '주간연장', work_hours: 11, double_jo: 422, double_m2: 579.17 }),
    [dayKey('2026-10-28', 1)]: day({ shift_type: '주간연장', work_hours: 11, double_jo: 480, double_m2: 445.6 }),
    [dayKey('2026-10-29', 1)]: day({ shift_type: '평일', work_hours: 8 }),
    [dayKey('2026-10-30', 1)]: day({ shift_type: '휴무' }),
    [dayKey('2026-10-31', 1)]: day({ shift_type: '주말' }),
  };
  const sheet = buildWeeklySheet('2026-10-26', entries, {});
  const line1 = sheet.lines[0];

  it('하루 줄', () => {
    const r = line1.rows[0];
    expect(r.target).toBeCloseTo(726);
    expect(r.jo).toBe(405);
    expect(r.joPerHour).toBeCloseTo(36.81818, 4);
    expect(r.joRate).toBeCloseTo(0.55785, 4);
    expect(r.m2PerHour).toBeCloseTo(52.42636, 4);
    expect(r.m2Rate).toBeCloseTo(0.79434, 4);
    expect(r.scoreA).toBeCloseTo(27.89256, 4);
    expect(r.scoreB).toBeCloseTo(43.25175, 4);
    expect(r.score).toBeCloseTo(71.14431, 4);
    expect(r.grade).toBe(' 사유?→');
    expect(r.barcodeRatio).toBeCloseTo(57.03704, 4);
    expect(r.crewTotal).toBe(5.5);
  });

  it('쉬는 날은 양식처럼 휴무로 나온다', () => {
    const r = line1.rows[4];
    expect([r.joPerHour, r.m2PerHour, r.scoreA, r.scoreB, r.score, r.grade]).toEqual(Array(6).fill('휴무'));
    expect(r.joRate).toBe(0);
  });

  it('소계', () => {
    const t = line1.totals;
    expect(t.hours).toBe(41);
    expect(t.target).toBeCloseTo(2706);
    expect(t.jo).toBe(1307);
    expect(t.m2).toBeCloseTo(1601.46);
    expect(t.joPerHour).toBeCloseTo(31.87805, 4);
    expect(t.scoreA).toBeCloseTo(24.15004, 4);
    expect(t.scoreB).toBeCloseTo(32.2245, 3);
    expect(t.score).toBeCloseTo(56.37454, 3);
  });

  it('3복층은 조 · M2 모두 2배로 더한다 — 회사 1031 2호기 10/26: 387 + 20 × 2 = 427', () => {
    const s = buildWeeklySheet('2026-10-26', {
      [dayKey('2026-10-26', 2)]: day({ work_hours: 11, double_jo: 387, double_m2: 430.07, triple_jo: 20, triple_m2: 34.49 }),
    }, {});
    expect(s.lines[1].rows[0].jo).toBe(427);
    expect(s.lines[1].rows[0].m2).toBeCloseTo(499.05);
  });

  it('사람이 고친 칸이 생산 기록보다 앞서고, 비운 칸은 생산 기록을 쓴다', () => {
    const auto = autoOutputs([log({ quantity_completed: 100, area_m2: 80 }), log({ quantity_completed: 6, area_m2: 9, product_name: '5A+12A+5B+12A+5C' })]);
    const none = buildWeeklySheet('2026-10-26', {}, auto).lines[0].rows[0];
    expect(none.double).toEqual({ jo: 100, m2: 80 });
    expect(none.triple).toEqual({ jo: 6, m2: 9 });
    expect(none.jo).toBe(112);
    // 회사가 2배를 주는 2겹 품목 — 맨 아래 칸에서 옮겨 적는다
    const moved = buildWeeklySheet('2026-10-26', {
      [dayKey('2026-10-26', 1)]: day({ double_jo: 60, triple_jo: 46 }),
    }, auto).lines[0].rows[0];
    expect(moved.double).toEqual({ jo: 60, m2: 80 });
    expect(moved.jo).toBe(152);
  });

  it('평가 구간 · 인원 총계', () => {
    expect(gradeOf(8, 100)).toBe('좋아요');
    expect(gradeOf(8, 95)).toBe('90~99');
    expect(gradeOf(8, 80)).toBe('80~89');
    expect(gradeOf(8, 79.9)).toBe(' 사유?→');
    expect(gradeOf(0, '휴무')).toBe('휴무');
    expect(crewTotal({ feed: 'a', finish2: 'b', butyl: 'c', banding: ' ' })).toBe(2.5);
  });
});

describe('엑셀', () => {
  const entries = {
    [dayKey('2026-09-28', 1)]: day({
      shift_type: '주간연장', work_hours: 11, barcode_qty: 100, crew: { feed: '갑', banding: '을' }, reason: '대규격',
      double_jo: 200, double_m2: 150.5, triple_jo: 10, triple_m2: 8,
    }),
    [dayKey('2026-10-03', 2)]: day({ shift_type: '주말', work_hours: 8, double_jo: 5, double_m2: 6 }),
  };
  const wb = buildWeeklyWorkbook(buildWeeklySheet('2026-09-28', entries, {}), entries);
  const ws = wb.getWorksheet('1003')!;
  const formula = (addr: string) => (ws.getCell(addr).value as ExcelJS.CellFormulaValue).formula;

  it('제목 · 시트 이름 · 날짜 — 달이 바뀌는 날은 1 을 직접 적는다', () => {
    expect(ws.getCell('B2').value).toBe(' 2026년 40주차  ( 10월  1주)');
    expect(ws.getCell('B7').value).toBe(9);
    expect(ws.getCell('C7').value).toBe(28);
    expect(formula('C8')).toBe('+C7+1');
    expect(ws.getCell('C10').value).toBe(1);
    expect(formula('C11')).toBe('+C10+1');
  });

  it('맨 아래 칸에 값이 들어가고, 위 표는 수식으로 끌어온다 — 아래를 고치면 위가 바뀐다', () => {
    expect(ws.getCell('H36').value).toBe(200);
    expect(ws.getCell('K36').value).toBe(150.5);
    expect(ws.getCell('H37').value).toBe(10);
    expect(ws.getCell('K37').value).toBe(8);
    expect(formula('H38')).toBe('+H36+H37*2');
    expect(formula('K38')).toBe('+K36+K37*2');
    expect(formula('U7')).toBe('+H38');
    expect(formula('X7')).toBe('+K38');
    expect(formula('T7')).toBe('F7*$D$4*$U$4');
    expect(formula('U23')).toBe('+H58');
    expect(ws.getCell('H71').value).toBe(5);
  });

  it('사람이 적은 칸 · 인원 수식 · 결과값', () => {
    expect(ws.getCell('E7').value).toBe('주간연장');
    expect(ws.getCell('F7').value).toBe(11);
    expect(ws.getCell('G7').value).toBe(100);
    expect(ws.getCell('I7').value).toBe('갑');
    expect(ws.getCell('R7').value).toBe('을');
    expect(ws.getCell('AE7').value).toBe('대규격');
    expect(formula('S7')).toBe('COUNTA(I7:L7)+COUNTA(M7:R7)/2');
    expect((ws.getCell('U7').value as ExcelJS.CellFormulaValue).result).toBe(220);
  });

  it('바코드 입력 비율은 생산조가 0 이어도 인쇄물에 ##### 이 안 나온다', () => {
    expect(formula('H8')).toBe('IFERROR((G8/U8)*100,"")');
  });

  it('인쇄 · 칸 설정이 양식과 같다', () => {
    expect(ws.pageSetup.printArea).toBe('B2:AE34');
    expect(ws.pageSetup.orientation).toBe('landscape');
    expect(ws.pageSetup.fitToPage).toBe(true);
    expect(ws.getColumn('AF').hidden).toBe(true);
    expect(ws.getRow(14).hidden).toBe(true);
    expect(ws.getRow(30).hidden).toBe(true);
    expect(ws.getColumn('AE').width).toBe(56.375);
    expect(WEEKLY_LAYOUT[1].bottomRow).toBe(56);
    expect(ws.getImages()).toHaveLength(2);
  });

  it('설계도에 사람 이름이 없다 — 공개 저장소', () => {
    const rows = (template as unknown as { rows: Record<string, { cells: Record<string, unknown[]> }> }).rows;
    for (const r of [7, 8, 9, 10, 11, 12, 23, 24, 25, 26, 27, 28]) {
      for (const c of 'IJKLMNOPQR') expect(rows[r].cells[c]?.[1]).toBeUndefined();
    }
  });
});

describe('더한 호기 — 미니라인', () => {
  const entries = { [dayKey('2026-10-26', 3)]: day({ work_hours: 8, double_jo: 40, double_m2: 30 }) };

  it('쓰는 호기와 기록이 있는 호기만 표가 생긴다', () => {
    expect(weeklyLineNumbers([1, 2], {}, {})).toEqual([1, 2]);
    expect(weeklyLineNumbers([1, 2, 3], {}, {})).toEqual([1, 2, 3]);
    expect(weeklyLineNumbers([1, 2], entries, {})).toEqual([1, 2, 3]);
    expect(weeklyLineNumbers([1, 2], {}, autoOutputs([log({ line_number: 4 })]))).toEqual([1, 2, 4]);
  });

  it('기록이 있으면 같은 양식의 시트가 하나 더 생기고 표 이름이 바뀐다', () => {
    const sheet = buildWeeklySheet('2026-10-26', entries, {}, DEFAULT_SETTINGS, [1, 2, 3]);
    const wb = buildWeeklyWorkbook(sheet, entries, DEFAULT_SETTINGS, n => (n === 3 ? '미니라인' : `${n}호기`));
    expect(wb.worksheets.map(w => w.name)).toEqual(['1031', '1031 미니라인']);
    const ws = wb.getWorksheet('1031 미니라인')!;
    expect((ws.getCell('B3').value as ExcelJS.CellRichTextValue).richText[1].text).toBe('미니라인');
    expect(ws.getCell('I5').value).toBe('생산 투입 총 인원-미니라인');
    expect(ws.getCell('H36').value).toBe(40);
    expect(wb.getWorksheet('1031')!.getCell('H36').value).toBeNull();
    // 더한 호기가 하나면 아래 표는 숨겨 표 하나만 인쇄한다
    expect(ws.pageSetup.printArea).toBe('B2:AE17');
    expect(ws.getRow(23).hidden).toBe(true);
    expect((ws.getCell('H23').value as ExcelJS.CellFormulaValue).formula).toBe('IFERROR((G23/U23)*100,"")');
  });

  it('호기가 한 주 내내 쉬어도 소계에 #DIV/0! 가 안 나온다 — 값이 있으면 양식 수식과 같다', () => {
    const wb = buildWeeklyWorkbook(buildWeeklySheet('2026-10-26', {}, {}), {});
    const ws = wb.getWorksheet('1031')!;
    const f = (addr: string) => (ws.getCell(addr).value as ExcelJS.CellFormulaValue).formula;
    expect(f('V13')).toBe('IFERROR(U13/F13,0)');
    expect(f('AA29')).toBe('IFERROR(U29/T29*AA20,0)');
    expect(f('U13')).toBe('SUM(U7:U12)');
  });

  it('기록이 없으면 시트를 만들지 않는다', () => {
    const sheet = buildWeeklySheet('2026-10-26', {}, {}, DEFAULT_SETTINGS, [1, 2, 3]);
    expect(buildWeeklyWorkbook(sheet, {}).worksheets.map(w => w.name)).toEqual(['1031']);
  });
});

describe('입력값 다듬기', () => {
  it('이번 주 날짜 · 호기 열쇠만 남기고 숫자로 바꾼다', () => {
    const days = weekOf('2026-10-26').days;
    const out = cleanEntries(days, {
      [dayKey('2026-10-26', 1)]: { shift_type: ' 평일 ', work_hours: '8.5', crew: { feed: ' 갑 ', nope: 'x' }, double_jo: '' },
      [dayKey('2026-11-02', 1)]: { shift_type: '평일' },
      [dayKey('2026-10-26', 100)]: { shift_type: '평일' },
      nonsense: {},
    });
    expect(Object.keys(out)).toEqual([dayKey('2026-10-26', 1)]);
    expect(out[dayKey('2026-10-26', 1)]).toMatchObject({ shift_type: '평일', work_hours: 8.5, crew: { feed: '갑' }, double_jo: null });
  });
});
