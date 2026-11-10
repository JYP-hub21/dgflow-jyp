import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { deliveryTodo } from '@/lib/production/delivery';
import { statusFor, workOrderStage } from '@/lib/work-order/stage';
import { planRevision, type ExistingItem, type RevisionInput } from '@/lib/work-order/revise';
import { proRataArea } from '@/lib/production/produced-quantity';
import { safeSheetName, buildWeeklyWorkbook } from '@/lib/production/weekly-excel';
import { DEFAULT_SETTINGS, buildWeeklySheet, dayKey, EMPTY_DAY_ENTRY } from '@/lib/production/weekly';
import { buildBokcheungWorkbook } from '@/lib/production/bokcheung-excel';
import type { BokcheungRow, BokcheungSheet } from '@/lib/production/bokcheung';

/** 2026-11-10 전체 점검 — 생산 · 납품 쪽 고친 것 */

describe('납품 완료는 품목마다 따진다', () => {
  // A 품목(의뢰 10)을 재고까지 20 내보내고 B 품목(의뢰 10)은 0 — 예전에는 의뢰서가 납품 완료로 닫혀 B 의 10 이 사라졌다
  const items = [{ id: 'A', quantity: 10, produced_quantity: 10 }, { id: 'B', quantity: 10, produced_quantity: 10 }];
  const delivered = new Map([['A', 20]]);

  it('할 일 — 더 나간 것은 그 품목 의뢰 수량까지만 센다', () => {
    expect(deliveryTodo(items, delivered)).toEqual({ quantity: 20, produced: 20, delivered: 10, remaining: 10, ready: 10 });
  });

  it('저장할 status — 다른 품목이 남았으면 끝난 건이 아니다', () => {
    const rows = items.map(i => ({ ...i, delivered: delivered.get(i.id) ?? 0 }));
    expect(statusFor(rows)).toBe('in_progress');
    expect(statusFor(rows.map(r => ({ ...r, delivered: r.id === 'B' ? 10 : r.delivered })))).toBe('completed');
  });

  it('배지 — 의뢰서 합을 그대로 넘겨도 status 가 진행 중이면 납품 완료로 안 보인다', () => {
    expect(workOrderStage('in_progress', { quantity: 20, produced: 20, delivered: 20 })).toBe('delivering');
  });
});

describe('작업의뢰서 수정 — 납품한 줄을 지키고 번호를 겹치지 않게', () => {
  const old = (o: Partial<ExistingItem> & { id: string; item_no: number }): ExistingItem => ({
    sort_order: o.item_no - 1, product_name: '22T 5CL+12A+5로이', width_mm: 1000, height_mm: 1000,
    quantity: 10, area_m2: 10, remark: null, produced_quantity: 0, ...o,
  });
  const row = (o: Partial<RevisionInput>): RevisionInput => ({
    product_name: '22T 5CL+12A+5로이', width_mm: 1000, height_mm: 1000, quantity: 10, area_m2: 10, remark: null, ...o,
  });

  it('생산 없이 납품만 있는 줄(외주 · 재고)도 문서에서 빠지면 지우지 않고 납품한 만큼 남긴다', () => {
    const plan = planRevision(
      [old({ id: 'a', item_no: 1 }), old({ id: 'b', item_no: 2, width_mm: 2000, area_m2: 20, delivered_quantity: 3 })],
      [row({ no: 1 })],
    );
    expect(plan.deletes).toEqual([]);
    expect(plan.removed[0]).toMatchObject({ id: 'b', kept: true, produced: 0, delivered: 3, kept_quantity: 3 });
    expect(plan.updates).toEqual([{ id: 'b', fields: { quantity: 3, sort_order: 1, area_m2: 6 } }]);
  });

  it('수량은 납품한 만큼 밑으로 줄이지 않는다 — 재고분이 더 나갔다고 의뢰 수량을 늘리지는 않는다', () => {
    const limited = planRevision([old({ id: 'a', item_no: 1, produced_quantity: 2, delivered_quantity: 6 })], [row({ no: 1, quantity: 4, area_m2: 4 })]);
    expect(limited.changed[0]).toMatchObject({ limited: true, produced: 2, delivered: 6, after: { quantity: 6 } });
    expect(limited.updates[0].fields).toMatchObject({ quantity: 6, area_m2: 6 });
    // 의뢰 10 에 25 가 나갔어도(재고분) 바닥은 10 — 문서가 12 로 늘리면 12, 8 로 줄이면 10 까지만
    const over = planRevision([old({ id: 'a', item_no: 1, delivered_quantity: 25 })], [row({ no: 1, quantity: 8, area_m2: 8 })]);
    expect(over.changed[0]).toMatchObject({ limited: true, after: { quantity: 10 } });
  });

  it('남기는 줄은 문서 마지막 번호 다음 번호를 받는다 — 상세 화면에 같은 번호가 두 줄 생기지 않게', () => {
    // 1–5번 중 3번이 문서에서 빠지고(생산 기록 있음) 4 · 5번이 3 · 4번으로 당겨진 경우
    const existing = [1, 2, 3, 4, 5].map(n => old({ id: `i${n}`, item_no: n, width_mm: 1000 + n, produced_quantity: n === 3 ? 2 : 0 }));
    const plan = planRevision(existing, [
      row({ no: 1, width_mm: 1001 }), row({ no: 2, width_mm: 1002 }), row({ no: 3, width_mm: 1004 }), row({ no: 4, width_mm: 1005 }),
    ]);
    const fieldsOf = (id: string) => plan.updates.find(u => u.id === id)?.fields;
    expect(fieldsOf('i4')).toMatchObject({ item_no: 3 });
    expect(fieldsOf('i5')).toMatchObject({ item_no: 4 });
    expect(fieldsOf('i3')).toMatchObject({ item_no: 5, quantity: 2, sort_order: 4 });
    const numbers = existing.map(e => fieldsOf(e.id)?.item_no ?? e.item_no);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe('기록 면적은 품목 면적(ERP 규칙)을 수량 비율로', () => {
  it('1719×1820×15 — 의뢰서 46.95 와 같게 (한 번에 반올림하면 46.93)', () => {
    const item = { width_mm: 1719, height_mm: 1820, quantity: 15, area_m2: 46.95 };
    expect(proRataArea(item, 15)).toBe(46.95);
    expect(proRataArea(item, 7)).toBe(21.91);
    // 저장 값이 글자로 와도 (numeric 열)
    expect(proRataArea({ ...item, area_m2: '46.95' }, 15)).toBe(46.95);
  });

  it('품목 면적이 없거나 의뢰 수량이 0 이면 ERP 규칙(장당 반올림 · 최소 3재)으로', () => {
    expect(proRataArea({ width_mm: 1719, height_mm: 1820, quantity: 0, area_m2: null }, 15)).toBe(46.95);
    expect(proRataArea({ width_mm: 300, height_mm: 500, quantity: 4, area_m2: null }, 2)).toBe(0.56);
  });
});

describe('주간생산일지 — 호기 이름에 엑셀이 못 받는 글자가 있어도', () => {
  it('시트 이름을 다듬는다 — 금지 글자 · 31자 · 겹침', () => {
    expect(safeSheetName('1031 A/B라인 [신]', [])).toBe('1031 A B라인 신');
    expect(safeSheetName("'1031 라인:2?'", [])).toBe('1031 라인 2');
    expect(safeSheetName('1031 아주아주아주아주아주아주아주아주아주아주아주긴이름', []).length).toBeLessThanOrEqual(31);
    expect(safeSheetName('1031 미니', ['1031 미니'])).toBe('1031 미니 (2)');
    expect(safeSheetName('1031 미니', ['1031 미니', '1031 미니 (2)'])).toBe('1031 미니 (3)');
  });

  it('엑셀 전체가 실패하지 않는다', async () => {
    const entries = { [dayKey('2026-10-26', 3)]: { ...EMPTY_DAY_ENTRY, work_hours: 8, double_jo: 40, double_m2: 30 } };
    const sheet = buildWeeklySheet('2026-10-26', entries, {}, DEFAULT_SETTINGS, [1, 2, 3]);
    const wb = buildWeeklyWorkbook(sheet, entries, DEFAULT_SETTINGS, n => (n === 3 ? 'A/B 라인' : `${n}호기`));
    expect(wb.worksheets.map(w => w.name)).toEqual(['1031', '1031 A B 라인']);
    await expect(wb.xlsx.writeBuffer()).resolves.toBeTruthy();
  });
});

describe('복층생산일지 — 한 장에 안 들어가는 날만 한 페이지에 맞추기', () => {
  const rowsOf = (n: number, line: number): BokcheungRow[] => Array.from({ length: n }, (_, i) => ({
    key: `${line}|wo${i}|5CL+12Ar.+5로이`, line, work_order_id: `wo${line}-${i}`, work_order_number: `26-${1000 + i}`,
    customer_site: '업체 현장', composition: '5CL+12Ar.+5로이', thickness: 22, argon: true,
    width_mm: 700, height_mm: 900, lead_quantity: 1, quantity: 1, area_m2: 0.63, continued: false, suggested_note: '1',
  }));
  const block = (line: number, n: number) => ({ line, name: `${line}호기`, rows: rowsOf(n, line), quantity: n, area_m2: 0.63 * n });
  const setupOf = async (blocks: BokcheungSheet['blocks']) => {
    const sheet: BokcheungSheet = { date: '2026-10-30', blocks, excluded: { quantity: 0, names: [] }, cumulative: { quantity: 0, area_m2: 0 } };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildBokcheungWorkbook(sheet, {}).xlsx.writeBuffer());
    return wb.worksheets[0].pageSetup;
  };

  it('평소 날(45줄) · 한 줄 더한 날은 회사 양식 그대로 84%', async () => {
    for (const blocks of [[block(1, 10), block(2, 5)], [block(1, 17), block(2, 5)]]) {
      const ps = await setupOf(blocks);
      expect(ps.scale).toBe(84);
      expect(ps.fitToPage).toBeFalsy();
    }
  });

  it('덩어리가 길거나 셋째 호기가 붙어 넘치는 날은 한 페이지에 맞춘다', async () => {
    for (const blocks of [[block(1, 25), block(2, 5)], [block(1, 10), block(2, 5), block(3, 4)]]) {
      const ps = await setupOf(blocks);
      expect(ps).toMatchObject({ fitToPage: true, fitToWidth: 1, fitToHeight: 1 });
    }
  });
});
