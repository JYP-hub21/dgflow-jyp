// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { openXlsx, serialToIsoDate, type CellValue } from '@/lib/excel/xlsx-rows';
import {
  MAX_FILL_GAP, MesCollector, dailyTotals, groupPieces, groupQty, minutesOfDay, normalizeWorkOrderNumber, parseLine, shiftOf, toIsoDate,
  type MesGroup,
} from '@/lib/production/mes';
import { mesToLog, netDailyTotals, toMesRow, withoutManualOverlap } from '@/lib/production/mes-db';
import { planMesItems, type MesItemRow } from '@/lib/production/mes-items';
import { isMesOrder, logArea, missingNos, otherKey, planMesOrders, planMesReupload, planOtherOrderMes, systemProductName, type MesOrderLog, type MesSeenRow } from '@/lib/production/mes-orders';
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

describe('MES 의뢰서 품목 수정 — 요청 검사 (lib/production/mes-items.ts planMesItems)', () => {
  const row = (id: string, no: number, quantity = 10): MesItemRow =>
    ({ id, item_no: no, sort_order: no - 1, product_name: '24T 6CL+12A+6CL', width_mm: 1455, height_mm: 2785, quantity, area_m2: 40.5 });
  const items = [row('a', 2, 1), row('b', 3, 20), row('c', 4, 16)];      // No.1 이 빠진 의뢰서
  const today = '2026-11-16';
  const ok = (body: unknown) => { const r = planMesItems(items, body, today); if ('error' in r) throw new Error(r.error); return r.plan; };
  const err = (body: unknown) => { const r = planMesItems(items, body, today); return 'error' in r ? r.error : ''; };

  it('빠진 번호로 품목을 더한다 — 생산일이 있으면 그날 만든 것으로', () => {
    const plan = ok({ add: [{ item_no: 1, product_name: ' 24T 5CL+14A+5CL ', width_mm: 1305, height_mm: 1963, quantity: 3, produced_date: '2026-11-10', line_number: 2 }] });
    expect(plan.add).toEqual([{ item_no: 1, product_name: '24T 5CL+14A+5CL', width_mm: 1305, height_mm: 1963, quantity: 3, produced_date: '2026-11-10', line_number: 2, shift: 'day' }]);
  });
  it('생산일을 비우면 아직 안 만든 품목(생산 기록 없음)', () => {
    expect(ok({ add: [{ item_no: 9, product_name: 'x', width_mm: 100, height_mm: 100, quantity: 1, produced_date: '' }] }).add[0].produced_date).toBeNull();
  });
  it('이미 있는 번호 · 서로 겹치는 번호로는 더하지 못한다', () => {
    const add = { product_name: 'x', width_mm: 100, height_mm: 100, quantity: 1 };
    expect(err({ add: [{ ...add, item_no: 3 }] })).toContain('No.3 은(는) 이미 있습니다');
    expect(err({ add: [{ ...add, item_no: 7 }, { ...add, item_no: 7 }] })).toContain('No.7 은(는) 이미 있습니다');
  });
  it('지우는 품목의 번호는 다시 쓸 수 있다', () => {
    const plan = ok({ remove: ['b'], add: [{ item_no: 3, product_name: 'x', width_mm: 100, height_mm: 100, quantity: 2 }] });
    expect(plan.remove).toEqual(['b']);
    expect(plan.add[0].item_no).toBe(3);
  });
  it('수량 · 품명 · 규격은 바뀐 것만 남긴다', () => {
    const plan = ok({ update: [{ id: 'a', quantity: 1, product_name: '24T 6CL+12A+6CL' }, { id: 'b', quantity: 22, width_mm: 1500 }], remove: ['c'] });
    expect(plan.update).toEqual([{ id: 'b', quantity: 22, width_mm: 1500 }]);
  });
  it('틀린 값은 아무것도 바꾸기 전에 거른다', () => {
    expect(err({ update: [{ id: 'a', quantity: 0 }] })).toContain('수량은 1 이상');
    expect(err({ update: [{ id: 'a', product_name: '  ' }] })).toContain('품명');
    expect(err({ update: [{ id: 'zzz', quantity: 3 }] })).toContain('이 작업의뢰서의 품목이 아닙니다');
    expect(err({ add: [{ item_no: 1, product_name: 'x', width_mm: 0, height_mm: 100, quantity: 1 }] })).toContain('가로 · 세로');
    expect(err({ add: [{ item_no: 1, product_name: 'x', width_mm: 100, height_mm: 100, quantity: 1, produced_date: '2026-11-17' }] })).toContain('오늘보다 뒤');
    expect(err({ add: [{ item_no: 1, product_name: 'x', width_mm: 100, height_mm: 100, quantity: 1, produced_date: '11/10' }] })).toContain('날짜');
  });
  it('품목을 전부 지울 수는 없고, 바꿀 것이 없으면 알린다', () => {
    expect(err({ remove: ['a', 'b', 'c'] })).toContain('전부 지울 수는 없습니다');
    expect(err({})).toContain('바꿀 내용이 없습니다');
    expect(err({ update: [{ id: 'a', quantity: 1 }] })).toContain('바꿀 내용이 없습니다');
  });
});

describe('MES 파일 다시 올리기 — 지난번과 달라진 것만 (lib/production/mes-orders.ts planMesReupload, 11/16 점검 P2)', () => {
  const log = (no: number, date: string, quantity: number, line = 1, shift: 'day' | 'night' = 'day'): MesOrderLog => ({ no, date, line, shift, quantity });
  const seen = (no: number, date: string, quantity: number, line = 1, shift: 'day' | 'night' = 'day'): MesSeenRow => ({ no, date, line, shift, quantity });
  // 지난번: 10/22 – 11/11 을 골라 올렸다. 의뢰서는 통째로라 10/20 생산(NO 1)도 그때 들어갔다
  const file = [log(1, '2026-10-20', 4), log(1, '2026-10-22', 6), log(2, '2026-10-23', 10), log(3, '2026-11-11', 5, 2, 'night')];
  const before = [seen(1, '2026-10-22', 6), seen(2, '2026-10-23', 10), seen(3, '2026-11-11', 5, 2, 'night')];

  it('같은 파일을 다시 올리면 아무것도 바꾸지 않는다 — 사람이 고친 수량이 되돌아가지 않는다', () => {
    expect(planMesReupload({ logs: file }, before, [1, 2, 3])).toEqual({ newNos: [], fresh: [], changed: [], removedNos: [] });
  });

  it('기간 앞의 생산(표에는 없지만 그때 통째로 넣은 것)도 다시 넣지 않는다', () => {
    const plan = planMesReupload({ logs: file }, before, [1, 2, 3]);
    expect(plan.fresh.some(l => l.date === '2026-10-20')).toBe(false);
  });

  it('화면에서 지운 품목은 다시 만들지 않는다', () => {
    const plan = planMesReupload({ logs: file }, before, [1, 3]);
    expect(plan.removedNos).toEqual([2]);
    expect(plan.newNos).toEqual([]);
    expect(plan.fresh).toEqual([]);
    // 기간 앞에만 생산이 있던 품목을 지운 경우도 같다
    const early = [log(9, '2026-10-01', 3), ...file];
    expect(planMesReupload({ logs: early }, before, [1, 2, 3]).removedNos).toEqual([9]);
  });

  it('새 파일에 새로 생긴 생산 — 뒤 날짜 · 다른 호기 · 새 NO 만 붙인다', () => {
    const next = [...file, log(2, '2026-11-12', 8), log(2, '2026-10-23', 3, 2), log(7, '2026-11-13', 2)];
    const plan = planMesReupload({ logs: next }, before, [1, 2, 3]);
    expect(plan.fresh).toEqual([log(2, '2026-11-12', 8), log(2, '2026-10-23', 3, 2), log(7, '2026-11-13', 2)]);
    expect(plan.newNos).toEqual([7]);
    expect(plan.changed).toEqual([]);
  });

  it('지난번에도 있던 줄의 장수가 달라졌으면 달라진 만큼만', () => {
    const next = [log(1, '2026-10-20', 4), log(1, '2026-10-22', 6), log(2, '2026-10-23', 13), log(3, '2026-11-11', 4, 2, 'night')];
    const plan = planMesReupload({ logs: next }, before, [1, 2, 3]);
    expect(plan.changed).toEqual([{ ...log(2, '2026-10-23', 13), delta: 3 }, { ...log(3, '2026-11-11', 4, 2, 'night'), delta: -1 }]);
    expect(plan.fresh).toEqual([]);
  });

  it('화면에서 손으로 더한 품목(MES 에 없던 NO)에 뒤늦게 MES 생산이 오면 새 생산으로 붙인다', () => {
    const plan = planMesReupload({ logs: [...file, log(5, '2026-11-12', 2)] }, before, [1, 2, 3, 5]);
    expect(plan.fresh).toEqual([log(5, '2026-11-12', 2)]);
    expect(plan.newNos).toEqual([]);
  });

  it('지난번 내용이 없으면(표가 생기기 전 의뢰서) 전부 새 줄로 돌려준다 — 넣는 쪽이 같은 날 · 호기 기록을 건너뛴다', () => {
    const plan = planMesReupload({ logs: file }, [], [1, 2]);
    expect(plan.fresh).toEqual(file);
    expect(plan.newNos).toEqual([3]);
    expect(plan.removedNos).toEqual([]);
  });
});

describe('MES 로 만든 작업의뢰서는 생산 기록이 원본 — 그 의뢰번호의 MES 줄은 일지에 쓰지 않는다 (11/16 점검 P6)', () => {
  const grp: MesGroup = {
    wo: '26-2573', no: 3, date: '2026-10-22', line: 1, shift: 'day', scanned: 2, filled: 8,
    product: '5CL+12A+5로이', width: 559, height: 1217, customer: '거래처A', site: '현장A', remark: '',
  };
  const rows = [toMesRow(grp), toMesRow({ ...grp, date: '2026-10-23' }), toMesRow({ ...grp, wo: '26-2600' })];
  const made = new Set(['26-2573']);

  it('그날 생산 기록이 통째로 지워져도 MES 줄이 되살아나지 않는다', () => {
    // 26-2573 은 10/22 기록만 남고 10/23 기록은 수량을 줄이다 지워졌다
    const manual = [{ work_order_number: '26-2573', production_date: '2026-10-22' }];
    expect(withoutManualOverlap(rows, manual).map(r => `${r.work_order_number} ${r.production_date}`)).toEqual(['26-2573 2026-10-23', '26-2600 2026-10-22']);
    expect(withoutManualOverlap(rows, manual, made).map(r => `${r.work_order_number} ${r.production_date}`)).toEqual(['26-2600 2026-10-22']);
  });

  it('누계도 같다', () => {
    const light = rows.map(r => ({ production_date: r.production_date, work_order_number: r.work_order_number, quantity: r.quantity, area_m2: r.area_m2 }));
    expect(netDailyTotals(light, [], made)).toEqual([{ date: '2026-10-22', quantity: 10, area_m2: 6.8 }]);
  });
});

describe('사람이 등록한 작업의뢰서에 MES 붙이기 — 손 입력과 두 번 세지 않게 (planOtherOrderMes, 11/16 점검 P3)', () => {
  const log = (date: string, quantity: number, line = 1, shift: 'day' | 'night' = 'day'): MesOrderLog => ({ no: 1, date, line, shift, quantity });
  const state = (over: Partial<{ quantity: number; produced: number; mesQty: number; have: Set<string> }> = {}) =>
    ({ quantity: 40, produced: 0, mesQty: 0, have: new Set<string>(), ...over });

  it('손으로 넣은 생산이 있으면 MES 는 더하지 않는다 — 날 · 호기가 달라도', () => {
    // 생산관리부가 11/17 주간 1호기로 40조를 넣었고, MES 는 같은 유리를 11/16 2호기 야간으로 찍었다
    const r = planOtherOrderMes(state({ produced: 40, have: new Set([otherKey(log('2026-11-17', 40))]) }), [log('2026-11-16', 40, 2, 'night')]);
    expect(r).toEqual({ add: [], manual: true, capped: 0 });
  });

  it('지난 의뢰서 가져오기의 "출고만큼 생산"(기록 없이 수량만)도 손 입력으로 본다', () => {
    expect(planOtherOrderMes(state({ produced: 30 }), [log('2026-11-16', 40)]).manual).toBe(true);
  });

  it('손 입력이 없으면 MES 생산을 붙이되 의뢰 수량까지만', () => {
    const r = planOtherOrderMes(state(), [log('2026-11-17', 30), log('2026-11-16', 15)]);
    // 날짜순으로 채운다 — 11/16 15조, 11/17 25조, 넘는 5조는 넣지 않는다
    expect(r.add).toEqual([log('2026-11-16', 15), log('2026-11-17', 25)]);
    expect(r.capped).toBe(5);
    expect(r.manual).toBe(false);
  });

  it('MES 가 넣은 기록만 있으면 손 입력이 아니다 — 다음 파일의 새 생산을 이어서 붙인다', () => {
    const before = state({ produced: 15, mesQty: 15, have: new Set([otherKey(log('2026-11-16', 15))]) });
    const r = planOtherOrderMes(before, [log('2026-11-16', 15), log('2026-11-18', 20)]);
    expect(r.add).toEqual([log('2026-11-18', 20)]);
    expect(r.capped).toBe(0);
  });

  it('같은 파일을 다시 올리면 아무것도 더하지 않는다', () => {
    const r = planOtherOrderMes(state({ produced: 40, mesQty: 40, have: new Set([otherKey(log('2026-11-16', 15)), otherKey(log('2026-11-17', 25))]) }),
      [log('2026-11-16', 15), log('2026-11-17', 30)]);
    expect(r.add).toEqual([]);
    // 이미 들어간 줄은 건너뛸 뿐 '넘는 수량' 으로 세지 않는다
    expect(r.capped).toBe(0);
  });

  it('생산일지 — 시스템에 의뢰서가 있으면 날짜가 달라도 MES 줄을 쓰지 않는다', () => {
    const grp: MesGroup = {
      wo: '26-3001', no: 1, date: '2026-11-16', line: 2, shift: 'night', scanned: 2, filled: 38,
      product: '5CL+12A+5로이', width: 559, height: 1217, customer: '거래처A', site: '현장A', remark: '',
    };
    const manual = [{ work_order_number: '26-3001', production_date: '2026-11-17' }];
    // 예전: 날짜가 다르면 MES 줄도 일지에 들어가 손 입력 40조와 함께 두 번 셌다
    expect(withoutManualOverlap([toMesRow(grp)], manual)).toHaveLength(1);
    expect(withoutManualOverlap([toMesRow(grp)], manual, new Set(['26-3001']))).toHaveLength(0);
  });
});
