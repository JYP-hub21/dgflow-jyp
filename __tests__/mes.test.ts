// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { openXlsx, serialToIsoDate, type CellValue } from '@/lib/excel/xlsx-rows';
import {
  MesCollector, groupPieces, isInsert, minutesOfDay, normalizeWorkOrderNumber, parseLine, planMesImport, shiftOf, toIsoDate,
  type MesDbOrder, type MesGroup,
} from '@/lib/production/mes';
import { parseMesBytes } from '@/lib/production/mes-read';

const HEAD = ['S', '등록일시', 'PID', '공정', '품목코드', '품명', '가로', '세로', '수량', '평수', '의뢰번호', 'NO.', '거래처', '현장', '라인', '등록자', '비고', '일자'];
// 2026-10-22 = 46317
const D1022 = 46317;
const row = (pid: string, wo: string, no: number, line: string, date = D1022, w = 640, h = 2355, remark: unknown = '') =>
  [false, date + 0.4, pid, '포장공정', 'P1', '5CL+12A+5CL', w, h, 1, 7.4, wo, no, '우신산업(주)a', '현장A', line, '복층1', remark, date];

describe('의뢰번호 · 라인 · 날짜 읽기', () => {
  it('의뢰번호를 시스템 꼴로', () => {
    expect(normalizeWorkOrderNumber('26-2573')).toBe('26-2573');
    expect(normalizeWorkOrderNumber('2026-0388')).toBe('26-0388');
    expect(normalizeWorkOrderNumber(' 26-2463★')).toBe('26-2463');
    expect(normalizeWorkOrderNumber('')).toBeNull();
    expect(normalizeWorkOrderNumber('ABC')).toBeNull();
    expect(normalizeWorkOrderNumber(262573)).toBeNull();
  });
  it('라인 → 호기', () => {
    expect(parseLine('1-LINE')).toBe(1);
    expect(parseLine('2-LINE')).toBe(2);
    expect(parseLine('2호기')).toBe(2);
    expect(parseLine('')).toBe(0);
  });
  it('날짜 — 엑셀 일련번호 · 글자 · Date', () => {
    expect(serialToIsoDate(D1022)).toBe('2026-10-22');
    expect(serialToIsoDate(D1022 + 0.99)).toBe('2026-10-22');
    expect(toIsoDate(46024)).toBe('2026-01-02');
    expect(toIsoDate('2026.1.5')).toBe('2026-01-05');
    expect(toIsoDate(new Date(2026, 9, 22, 8, 30))).toBe('2026-10-22');
    expect(toIsoDate('')).toBeNull();
  });
});

describe('MES 줄 모으기', () => {
  it('머리 줄 앞은 버리고, 빈 줄은 건너뛰고, 같은 바코드는 한 번만', () => {
    const c = new MesCollector();
    c.add(['MES 생산실적'], 1);
    c.add(HEAD, 2);
    c.add(row('KCN1', '26-2573', 1, '2-LINE'), 3);
    c.add(row('KCN1', '26-2573', 1, '2-LINE'), 4); // 같은 바코드
    c.add(row('KCN2', '2026-2573', 1, '2-LINE'), 5);
    c.add([], 6);
    c.add([false, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 46317], 7); // 수식만 남은 빈 줄
    c.add(row('KCN3', '', 2, '1-LINE'), 8);
    c.add(row('KCN4', '26-2573', 0, '1-LINE'), 9);
    c.add(row('KCN5', '26-2573', 3, '1-LINE', D1022, 640, 2355, 46035), 10);
    const r = c.result('Data');
    expect(c.headerFound).toBe(true);
    expect(r.pieces.map(p => [p.wo, p.no, p.date, p.line])).toEqual([
      ['26-2573', 1, '2026-10-22', 2], ['26-2573', 1, '2026-10-22', 2], ['26-2573', 3, '2026-10-22', 1],
    ]);
    expect(r.duplicates).toBe(1);
    expect(r.skipped.map(x => [x.reason.slice(0, 9), x.count, x.rows])).toEqual([
      ['의뢰번호를 알아볼', 1, [8]], ['NO. 가 비었거', 1, [9]],
    ]);
    // 날짜를 적은 비고가 일련번호로 바뀐 것은 날짜로 되돌린다
    expect(r.pieces[2].remark).toBe('2026-01-13');
  });

  it('필요한 칸이 없으면 머리를 못 찾고 빠진 칸을 알려 준다', () => {
    const c = new MesCollector();
    c.add(['일자', '의뢰번호', '품명'], 1);
    expect(c.headerFound).toBe(false);
    expect(c.missingColumns()).toEqual(['NO.', '라인']);
  });
});

const g = (p: Partial<MesGroup>): MesGroup => ({
  wo: '26-2573', no: 1, date: '2026-10-22', line: 2, shift: 'day', count: 1, product: '', width: 640, height: 2355, customer: '', site: '', remark: '', ...p,
});
const order = (items: Partial<MesDbOrder['items'][number]>[], site = 'ochang'): MesDbOrder => ({
  id: 'wo1', work_order_number: '26-2573', production_site: site,
  items: items.map((it, i) => ({
    id: `it${i + 1}`, no: i + 1, product_name: '24T 5CL', width_mm: 640, height_mm: 2355, quantity: 10, area_m2: 15, logs: [], ...it,
  })),
});

describe('넣을 계획', () => {
  it('기간 안만 날짜 · 호기별로 묶는다', () => {
    const c = new MesCollector();
    c.add(HEAD, 1);
    c.add(row('A', '26-2573', 1, '2-LINE'), 2);
    c.add(row('B', '26-2573', 1, '2-LINE'), 3);
    c.add(row('C', '26-2573', 1, '1-LINE'), 4);
    c.add(row('D', '26-2573', 1, '1-LINE', D1022 + 1), 5);
    c.add(row('E', '26-2573', 1, '1-LINE', D1022 - 30), 6);
    const groups = groupPieces(c.result('Data').pieces, '2026-10-22', '2026-10-31');
    expect(groups.map(x => [x.date, x.line, x.count])).toEqual([
      ['2026-10-22', 1, 1], ['2026-10-22', 2, 2], ['2026-10-23', 1, 1],
    ]);
  });

  it('등록 · 이미 등록됨 · 의뢰 수량까지만 · 초과', () => {
    const orders = new Map([['26-2573', order([
      { quantity: 5, logs: [{ date: '2026-10-22', line: 2, shift: 'day', qty: 2 }] },
      { quantity: 3 },
    ])]]);
    const plan = planMesImport([
      g({ count: 2 }),                                    // 1번 10/22 2호기: 이미 2 → 이미 등록됨
      g({ date: '2026-10-23', count: 2 }),                // 1번: 2 넣음 (합 4)
      g({ date: '2026-10-24', count: 3 }),                // 1번: 1만 넣음 (의뢰 5)
      g({ date: '2026-10-25', count: 1 }),                // 1번: 꽉 참 → 초과
      g({ no: 2, date: '2026-10-23', line: 1, count: 3 }), // 2번: 3 넣음
    ], orders);
    expect(plan.map(r => [r.no, r.date, r.status, r.add, r.already])).toEqual([
      [1, '2026-10-22', 'done', 0, 2],
      [1, '2026-10-23', 'add', 2, 0],
      [1, '2026-10-24', 'partial', 1, 0],
      [1, '2026-10-25', 'over', 0, 0],
      [2, '2026-10-23', 'add', 3, 0],
    ]);
    expect(plan.filter(isInsert).reduce((t, r) => t + r.add, 0)).toBe(6);
  });

  it('같은 날 · 호기에 손으로 넣은 것이 일부 있으면 모자란 만큼만', () => {
    const orders = new Map([['26-2573', order([{ logs: [
      { date: '2026-10-22', line: 2, shift: 'day', qty: 3 }, { date: '2026-10-22', line: 1, shift: 'day', qty: 4 },
      // 같은 날 · 호기라도 야간 기록은 주간 바코드와 따로 센다
      { date: '2026-10-22', line: 2, shift: 'night', qty: 1 },
    ] }])]]);
    const [r] = planMesImport([g({ count: 5 })], orders);
    expect([r.status, r.add, r.already]).toEqual(['add', 2, 3]);
  });

  it('같은 계획을 두 번 넣지 않는다 — 넣은 뒤 다시 계산하면 전부 이미 등록됨', () => {
    const groups = [g({ count: 4 }), g({ date: '2026-10-23', count: 3 })];
    const first = planMesImport(groups, new Map([['26-2573', order([{}])]]));
    const logs = first.filter(isInsert).map(r => ({ date: r.date, line: r.line, shift: r.shift, qty: r.add }));
    const second = planMesImport(groups, new Map([['26-2573', order([{ logs }])]]));
    expect(second.map(r => r.status)).toEqual(['done', 'done']);
  });

  it('미등록 · 없는 NO · 규격 다름(돌려 적은 것은 같음) · 호기 모름 · 외주 표시', () => {
    const orders = new Map([['26-2573', order([{}, { width_mm: 1000, height_mm: 500 }], 'outsource')]]);
    const plan = planMesImport([
      g({ wo: '26-9999' }),
      g({ no: 7 }),
      g({ no: 2, width: 500, height: 1000 }),
      g({ no: 2, date: '2026-10-23', width: 501, height: 1000 }),
      g({ line: 0, date: '2026-10-24' }),
    ], orders);
    const by = (wo: string, no: number, date = '2026-10-22') => plan.find(r => r.wo === wo && r.no === no && r.date === date)!;
    expect(by('26-9999', 1).status).toBe('no-order');
    expect(by('26-2573', 7).status).toBe('no-item');
    expect(by('26-2573', 2).status).toBe('add');
    expect(by('26-2573', 2).outsource).toBe(true);
    expect(by('26-2573', 2, '2026-10-23').status).toBe('size');
    expect(by('26-2573', 1, '2026-10-24').status).toBe('line');
  });
});

describe('빠른 xlsx 읽기', () => {
  const book = (sst: boolean, sheets: Record<string, unknown[][]>) => {
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', bookSST: sst }) as ArrayBuffer);
  };

  for (const sst of [true, false]) {
    it(`시트 목록 · 글자 · 숫자 · 참거짓 · 빈 칸 (공유 문자열 ${sst ? '사용' : '안 씀'})`, async () => {
      const b = await openXlsx(book(sst, {
        Report: [['요약']],
        Data: [['이름', '수', '맞음'], ['A & <B>', 12.5, true], [], ['줄\n바꿈', '', false]],
      }));
      expect(b.sheets.map(s => s.name)).toEqual(['Report', 'Data']);
      const rows: [number, CellValue[]][] = [];
      await b.eachRow(b.sheets[1].path, (cells, no) => { rows.push([no, cells]); });
      expect(rows.map(([no, c]) => [no, [...c]])).toEqual([
        [1, ['이름', '수', '맞음']],
        [2, ['A & <B>', 12.5, true]],
        [4, ['줄\n바꿈', '', false]],
      ]);
    });
  }

  it('MES 파일 — Data 시트를 먼저, 피벗(Report)은 뒤로', async () => {
    const bytes = book(true, {
      Report: [['일자', '의뢰번호', 'NO.', '라인', ' 수량'], [D1022, '26-2573', 1, '2-LINE', 9]],
      Data: [HEAD, row('A', '26-2573', 1, '2-LINE'), row('B', '26-2573', 1, '2-LINE')],
    });
    const r = await parseMesBytes(bytes.buffer as ArrayBuffer, 'mes.xlsx');
    expect(r.sheet).toBe('Data');
    expect(r.pieces).toHaveLength(2);
  });

  it('필요한 칸이 없으면 알려 준다', async () => {
    const bytes = book(true, { Sheet1: [['일자', '의뢰번호'], [D1022, '26-2573']] });
    await expect(parseMesBytes(bytes.buffer as ArrayBuffer, 'x.xlsx')).rejects.toThrow(/NO\., 라인/);
  });
});

describe('주간 · 야간 (2026-11-13 회의: 야간 18:00–21:00)', () => {
  it('시각 읽기 — 일련번호 · 글자 · Date', () => {
    expect(minutesOfDay(D1022 + 0.75)).toBe(18 * 60);
    expect(minutesOfDay('2026-10-22 17:45')).toBe(17 * 60 + 45);
    expect(minutesOfDay('18:05')).toBe(18 * 60 + 5);
    expect(minutesOfDay(new Date(2026, 9, 22, 20, 30))).toBe(20 * 60 + 30);
    expect(minutesOfDay('')).toBeNull();
  });

  it('18:00 부터 야간, 석식 시간(17:30–18:00)은 주간, 시각을 모르면 주간', () => {
    expect(shiftOf(17 * 60 + 59)).toBe('day');
    expect(shiftOf(18 * 60)).toBe('night');
    expect(shiftOf(8 * 60 + 30)).toBe('day');
    expect(shiftOf(null)).toBe('day');
  });

  it('같은 날 · 호기라도 주간 · 야간을 따로 묶는다', () => {
    const c = new MesCollector();
    c.add(HEAD, 1);
    c.add(row('A', '26-2573', 1, '2-LINE', D1022 + 0.4), 2);   // 09:36
    c.add(row('B', '26-2573', 1, '2-LINE', D1022 + 0.74), 3);  // 17:45 석식 — 주간
    c.add(row('C', '26-2573', 1, '2-LINE', D1022 + 0.8), 4);   // 19:12 야간
    const groups = groupPieces(c.result('Data').pieces);
    expect(groups.map(x => [x.date, x.line, x.shift, x.count])).toEqual([
      ['2026-10-22', 2, 'day', 2], ['2026-10-22', 2, 'night', 1],
    ]);
  });
});
