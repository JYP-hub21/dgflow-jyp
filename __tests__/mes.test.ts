// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { openXlsx, serialToIsoDate, type CellValue } from '@/lib/excel/xlsx-rows';
import {
  MAX_FILL_GAP, MesCollector, dailyTotals, groupPieces, groupQty, minutesOfDay, normalizeWorkOrderNumber, parseLine, shiftOf, toIsoDate,
  type MesGroup,
} from '@/lib/production/mes';
import { mesToLog, netDailyTotals, toMesRow, withoutManualOverlap } from '@/lib/production/mes-db';
import { isMesOrder, logArea, missingNos, planMesOrders, systemProductName } from '@/lib/production/mes-orders';
import { planRevision } from '@/lib/work-order/revise';
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

describe('기간 · 날짜 · 호기로 묶기', () => {
  it('기간 안만 날짜 · 호기별로 묶는다', () => {
    const c = new MesCollector();
    c.add(HEAD, 1);
    c.add(row('A', '26-2573', 1, '2-LINE'), 2);
    c.add(row('B', '26-2573', 1, '2-LINE'), 3);
    c.add(row('C', '26-2573', 1, '1-LINE'), 4);
    c.add(row('D', '26-2573', 1, '1-LINE', D1022 + 1), 5);
    c.add(row('E', '26-2573', 1, '1-LINE', D1022 - 30), 6);
    const { groups } = groupPieces(c.result('Data').pieces, '2026-10-22', '2026-10-31');
    expect(groups.map(x => [x.date, x.line, groupQty(x)])).toEqual([
      ['2026-10-22', 1, 1], ['2026-10-22', 2, 2], ['2026-10-23', 1, 1],
    ]);
  });
});

describe('바코드 번호 사이 채우기 (11/13 회의: 같은 규격은 첫 장 · 끝 장만 찍는다)', () => {
  it('첫 장 · 끝 장만 찍힌 품목은 사이 장수를 끝 장 쪽에 채운다', () => {
    const c = new MesCollector();
    c.add(HEAD, 1);
    c.add(row('KCI00101', '26-2573', 1, '1-LINE'), 2);
    c.add(row('KCI00180', '26-2573', 1, '1-LINE', D1022 + 1), 3); // 80장 중 첫 · 끝, 끝 장은 다음 날
    const { groups } = groupPieces(c.result('Data').pieces);
    expect(groups.map(x => [x.date, x.scanned, x.filled])).toEqual([
      ['2026-10-22', 1, 0], ['2026-10-23', 1, 78],
    ]);
    expect(groups.reduce((t, x) => t + groupQty(x), 0)).toBe(80);
  });

  it('다른 품목 · 다른 글자 묶음 · 너무 큰 빈틈은 채우지 않는다', () => {
    const c = new MesCollector();
    c.add(HEAD, 1);
    c.add(row('KCI00101', '26-2573', 1, '1-LINE'), 2);
    c.add(row('KCI00105', '26-2573', 2, '1-LINE'), 3);   // 다른 품목(NO 2)
    c.add(row('KCG00103', '26-2573', 1, '1-LINE'), 4);   // 다른 글자 묶음
    c.add(row(`KCI${String(101 + MAX_FILL_GAP + 2).padStart(5, '0')}`, '26-2573', 1, '1-LINE'), 5); // 빈틈이 MAX 넘음
    const { groups, bigGaps } = groupPieces(c.result('Data').pieces);
    expect(groups.reduce((t, x) => t + x.filled, 0)).toBe(0);
    expect(bigGaps).toBe(1);
  });

  it('기간 첫날 장은 기간 앞 장과의 빈틈도 가져간다', () => {
    const c = new MesCollector();
    c.add(HEAD, 1);
    c.add(row('KCI00001', '26-2573', 1, '1-LINE', D1022 - 1), 2);
    c.add(row('KCI00010', '26-2573', 1, '1-LINE'), 3);
    const { groups } = groupPieces(c.result('Data').pieces, '2026-10-22', '2026-10-22');
    expect(groups.map(x => [x.date, x.scanned, x.filled])).toEqual([['2026-10-22', 1, 8]]);
  });

  it('날짜별 합계 — 호기 · 주야간', () => {
    const c = new MesCollector();
    c.add(HEAD, 1);
    // 등록일시 칸(2번째)에 시각을 직접 넣는다
    const timed = (r: unknown[], frac: number) => { r[1] = D1022 + frac; return r; };
    c.add(timed(row('KCI00001', '26-2573', 1, '1-LINE'), 0.4), 2);   // 09:36
    c.add(timed(row('KCI00003', '26-2573', 1, '1-LINE'), 0.8), 3);   // 19:12 야간, 사이 1장
    c.add(timed(row('KCI00100', '26-2573', 2, '2-LINE'), 0.5), 4);   // 12:00
    const days = dailyTotals(groupPieces(c.result('Data').pieces).groups);
    expect(days).toEqual([{ date: '2026-10-22', scanned: 3, filled: 1, lines: { 1: { day: 1, night: 2 }, 2: { day: 1, night: 0 } } }]);
  });
});

describe('MES 실적 표 · 생산일지 모양 (lib/production/mes-db.ts)', () => {
  const grp: MesGroup = {
    wo: '26-2573', no: 3, date: '2026-10-22', line: 1, shift: 'night', scanned: 2, filled: 8,
    product: '5CL+12A+5로이', width: 559, height: 1217, customer: '거래처A', site: '현장A', remark: '',
  };
  it('면적은 작업의뢰서 규칙 — 장당 둘째 자리 반올림 · 최소 0.28M²', () => {
    const r = toMesRow(grp);
    expect(r.quantity).toBe(10);
    expect(r.area_m2).toBe(6.8); // 0.68 × 10
    expect(toMesRow({ ...grp, width: 300, height: 400 }).area_m2).toBe(2.8); // 0.12 → 최소 0.28
  });

  it('생산일지 줄 — 작업의뢰서 자리는 mes:의뢰번호, 순서는 NO', () => {
    const log = mesToLog(toMesRow(grp));
    expect(log.work_order_id).toBe('mes:26-2573');
    expect(log.work_order_item_id).toBe('mes:26-2573:3');
    expect(log.sort_order).toBe(2);
    expect(log.quantity_completed).toBe(10);
    expect(log.shift).toBe('night');
  });

  it('같은 의뢰번호 · 날짜에 손 입력이 있으면 MES 줄은 뺀다', () => {
    const rows = [toMesRow(grp), toMesRow({ ...grp, date: '2026-10-23' })];
    const left = withoutManualOverlap(rows, [{ work_order_number: '26-2573', production_date: '2026-10-22' }]);
    expect(left.map(r => r.production_date)).toEqual(['2026-10-23']);
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
    const { groups } = groupPieces(c.result('Data').pieces);
    expect(groups.map(x => [x.date, x.line, x.shift, groupQty(x)])).toEqual([
      ['2026-10-22', 2, 'day', 2], ['2026-10-22', 2, 'night', 1],
    ]);
  });
});

describe('MES → 지난 작업의뢰서 (lib/production/mes-orders.ts)', () => {
  const base: MesGroup = {
    wo: '26-1000', no: 1, date: '2026-10-22', line: 1, shift: 'day', scanned: 2, filled: 8,
    product: '5CL+12A+5로이', width: 559, height: 1217, customer: '거래처A', site: '현장A', remark: '101동',
  };
  it('품명 앞에 제품 두께를 붙인다 (이미 있으면 그대로)', () => {
    expect(systemProductName('5CL+12A+5로이')).toBe('22T 5CL+12A+5로이');
    expect(systemProductName('8.76(4cl+0.76+4cl)접합+12A+5로이')).toBe('25.76T 8.76(4cl+0.76+4cl)접합+12A+5로이');
    expect(systemProductName('24T 5CL+14A+5로이')).toBe('24T 5CL+14A+5로이');
    // 뒤 유리 두께가 빠진 품명 — 앞 유리와 같다고 본다 (ERP 두께 칸 24 와 같다)
    expect(systemProductName('5CL+14단열(Ar.)+로이h/s')).toBe('24T 5CL+14단열(Ar.)+로이h/s');
    // 괄호 속 + 가 있고 두께를 못 읽으면 그대로
    expect(systemProductName('(CL+0.76+CL)접합+12A+로이')).toBe('(CL+0.76+CL)접합+12A+로이');
  });
  it('의뢰번호 하나 = 의뢰서, NO 하나 = 품목, 수량은 날짜를 합친 MES 장수, 의뢰일은 첫 생산일', () => {
    const [o, o2] = planMesOrders([
      base,
      { ...base, date: '2026-10-21', line: 2, scanned: 5, filled: 0 },
      { ...base, no: 2, width: 300, height: 400, scanned: 1, filled: 0, remark: '' },
      { ...base, wo: '26-0999', scanned: 1, filled: 0 },
    ]);
    expect(o.work_order_number).toBe('26-0999');
    expect(o2.request_date).toBe('2026-10-21');
    expect(o2.items.map(i => [i.no, i.quantity, i.area_m2, i.remark])).toEqual([[1, 15, 10.2, '101동'], [2, 1, 0.28, null]]);
    expect(o2.logs.map(l => [l.no, l.date, l.line, l.quantity])).toEqual([[1, '2026-10-21', 2, 5], [1, '2026-10-22', 1, 10], [2, '2026-10-22', 1, 1]]);
    expect(logArea(o2.items[0], 5)).toBe(3.4);
  });
});

describe('MES 의뢰서 — 빠진 NO · 표시 · 수량 고치기', () => {
  it('MES 에 한 장도 안 찍힌 NO 를 찾는다', () => {
    expect(missingNos([1, 2, 4, 7])).toEqual([3, 5, 6]);
    expect(missingNos([1, 2, 3])).toEqual([]);
    expect(missingNos([])).toEqual([]);
  });
  it('메모로 MES 의뢰서를 가린다', () => {
    expect(isMesOrder('MES 생산실적으로 등록 2026-11-16 · 수량은 MES 바코드 기준')).toBe(true);
    expect(isMesOrder('ERP 주문번호 260102-01 · 지난 작업의뢰서 가져오기 2026-11-16 · 생산 기록은 MES 생산실적')).toBe(false);
    expect(isMesOrder(null)).toBe(false);
  });
  it('MES 의뢰서는 생산량 밑으로도 의뢰 수량을 줄일 수 있다 (생산 기록이 따라간다) — 납품량 밑으로는 아니다', () => {
    const existing = [{ id: 'a', item_no: 1, sort_order: 0, product_name: '24T 5CL+14A+5로이', width_mm: 700, height_mm: 900, quantity: 12, area_m2: 7.56, remark: null, produced_quantity: 12, delivered_quantity: 4 }];
    const incoming = [{ no: 1, product_name: '24T 5CL+14A+5로이', width_mm: 700, height_mm: 900, quantity: 10, area_m2: 6.3, remark: null }];
    expect(planRevision(existing, incoming).updates).toEqual([]); // 보통 의뢰서: 생산 12 밑으로 못 줄인다
    expect(planRevision(existing, incoming, { followProduction: true }).updates[0].fields.quantity).toBe(10);
    expect(planRevision(existing, [{ ...incoming[0], quantity: 3 }], { followProduction: true }).updates[0].fields.quantity).toBe(4);
  });
});

describe('누계용 MES 날짜별 합계 — 생산 기록과 겹치는 줄은 뺀다 (lib/production/mes-db.ts netDailyTotals)', () => {
  const mes = [
    { production_date: '2026-10-22', work_order_number: '26-2573', quantity: 10, area_m2: 12.5 },
    { production_date: '2026-10-22', work_order_number: '26-2600', quantity: 4, area_m2: '3.20' },
    { production_date: '2026-10-23', work_order_number: '26-2573', quantity: 7, area_m2: 8 },
  ];
  it('생산 기록이 없으면 날짜별로 전부 더한다', () => {
    expect(netDailyTotals(mes, [])).toEqual([
      { date: '2026-10-22', quantity: 14, area_m2: 15.7 },
      { date: '2026-10-23', quantity: 7, area_m2: 8 },
    ]);
  });
  it('같은 의뢰번호 · 같은 날에 생산 기록이 있으면 그 줄은 세지 않는다 (두 번 세지 않게)', () => {
    const manual = [{ work_order_number: '26-2573', production_date: '2026-10-22' }];
    expect(netDailyTotals(mes, manual)).toEqual([
      { date: '2026-10-22', quantity: 4, area_m2: 3.2 },
      { date: '2026-10-23', quantity: 7, area_m2: 8 },
    ]);
  });
  it('전부 겹치면 빈 목록', () => {
    const manual = mes.map(r => ({ work_order_number: r.work_order_number, production_date: r.production_date }));
    expect(netDailyTotals(mes, manual)).toEqual([]);
  });
});
