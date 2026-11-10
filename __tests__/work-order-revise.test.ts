import { describe, it, expect } from 'vitest';
import { invalidItems, planRevision, type ExistingItem, type RevisionInput } from '@/lib/work-order/revise';
import { statusFor, workOrderStage } from '@/lib/work-order/stage';
import { deliveredByItem, deliveredByWorkOrder, groupDeliveries, type DeliveryLog } from '@/lib/production/delivery';
import { searchCondition } from '@/components/work-order/ListSearch';
import { formatKst } from '@/lib/work-order/receipts';

/** 2026-11-06 회의 — 의뢰번호는 그대로, 일부가 없어지거나 수량이 바뀐다. 생산 기록은 지켜야 한다 */

const old = (o: Partial<ExistingItem> & { id: string; item_no: number }): ExistingItem => ({
  sort_order: o.item_no - 1, product_name: '22T 5CL+12A+5로이', width_mm: 1000, height_mm: 1000,
  quantity: 10, area_m2: 10, remark: null, produced_quantity: 0, ...o,
});
const row = (o: Partial<RevisionInput>): RevisionInput => ({
  product_name: '22T 5CL+12A+5로이', width_mm: 1000, height_mm: 1000, quantity: 10, area_m2: 10, remark: null, ...o,
});

describe('작업의뢰서 수정 계획', () => {
  it('같으면 아무것도 안 바꾼다', () => {
    const plan = planRevision([old({ id: 'a', item_no: 1 })], [row({ no: 1 })]);
    expect(plan).toMatchObject({ same: 1, changed: [], added: [], removed: [], updates: [], deletes: [] });
  });

  it('수량이 바뀌면 그 줄만 고치고 면적도 함께 바꾼다', () => {
    const plan = planRevision(
      [old({ id: 'a', item_no: 1 }), old({ id: 'b', item_no: 2, width_mm: 2000 })],
      [row({ no: 1, quantity: 7, area_m2: 7 }), row({ no: 2, width_mm: 2000 })],
    );
    expect(plan.same).toBe(1);
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0]).toMatchObject({ id: 'a', before: { quantity: 10 }, after: { quantity: 7 } });
    expect(plan.updates).toEqual([{ id: 'a', fields: { quantity: 7, area_m2: 7 } }]);
  });

  it('줄이 빠져 번호가 밀려도 규격으로 짝을 찾아 생산 기록을 잇는다 — 3–7번에서 5 · 6번이 없어진 경우', () => {
    const existing = [3, 4, 5, 6, 7].map(n => old({ id: `i${n}`, item_no: n, width_mm: 1000 + n, produced_quantity: n === 7 ? 4 : 0 }));
    const plan = planRevision(existing, [
      row({ no: 3, width_mm: 1003 }), row({ no: 4, width_mm: 1004 }), row({ no: 5, width_mm: 1007 }),
    ]);
    expect(plan.deletes).toEqual(['i5', 'i6']);
    expect(plan.removed.map(r => r.no)).toEqual([5, 6]);
    // 7번 줄은 지워지지 않고 번호만 문서대로 5번이 된다
    expect(plan.updates.find(u => u.id === 'i7')?.fields).toMatchObject({ item_no: 5 });
    expect(plan.added).toEqual([]);
  });

  it('비고만 바뀌어도 같은 품목으로 잇는다', () => {
    const plan = planRevision([old({ id: 'a', item_no: 1, remark: '101동', produced_quantity: 3 })], [row({ no: 1, remark: '102동' })]);
    expect(plan.deletes).toEqual([]);
    expect(plan.changed[0]).toMatchObject({ id: 'a', before: { remark: '101동' }, after: { remark: '102동' } });
  });

  it('같은 규격이 여러 줄이면 비고가 맞는 줄부터 짝짓는다', () => {
    const plan = planRevision(
      [old({ id: 'a', item_no: 1, remark: '外' }), old({ id: 'b', item_no: 2, remark: '內' })],
      [row({ no: 1, remark: '內' }), row({ no: 2, remark: '外' })],
    );
    expect(plan.same).toBe(2);
    expect(plan.updates.find(u => u.id === 'b')?.fields).toMatchObject({ item_no: 1, sort_order: 0 });
  });

  it('새 줄은 추가한다', () => {
    const plan = planRevision([old({ id: 'a', item_no: 1 })], [row({ no: 1 }), row({ no: 2, width_mm: 3000, remark: ' 신규 ' })]);
    expect(plan.added).toEqual([expect.objectContaining({ item_no: 2, sort_order: 1, width_mm: 3000, remark: '신규' })]);
  });

  it('문서에서 빠졌어도 생산 기록이 있으면 지우지 않고 수량을 생산한 만큼으로 줄인다', () => {
    const plan = planRevision(
      [old({ id: 'a', item_no: 1 }), old({ id: 'b', item_no: 2, width_mm: 2000, quantity: 10, area_m2: 20, produced_quantity: 4 })],
      [row({ no: 1 })],
    );
    expect(plan.deletes).toEqual([]);
    expect(plan.removed[0]).toMatchObject({ id: 'b', kept: true, produced: 4 });
    expect(plan.updates).toEqual([{ id: 'b', fields: { quantity: 4, sort_order: 1, area_m2: 8 } }]);
  });

  it('수량이 생산량보다 적어지면 생산량까지만 줄이고 알린다', () => {
    const plan = planRevision([old({ id: 'a', item_no: 1, produced_quantity: 6 })], [row({ no: 1, quantity: 4, area_m2: 4 })]);
    expect(plan.changed[0]).toMatchObject({ limited: true, after: { quantity: 6 } });
    expect(plan.updates[0].fields).toMatchObject({ quantity: 6, area_m2: 6 });
  });

  it('번호도 규격도 안 맞으면 지우고 새로 넣는다', () => {
    const plan = planRevision([old({ id: 'a', item_no: 1 })], [row({ no: 9, width_mm: 3000 })]);
    expect(plan.deletes).toEqual(['a']);
    expect(plan.added).toHaveLength(1);
  });

  it('번호가 같으면 규격이 바뀐 것으로 본다', () => {
    const plan = planRevision([old({ id: 'a', item_no: 1, produced_quantity: 2 })], [row({ no: 1, width_mm: 1100 })]);
    expect(plan.deletes).toEqual([]);
    expect(plan.changed[0]).toMatchObject({ before: { width_mm: 1000 }, after: { width_mm: 1100 } });
  });

  it('빈칸 검사', () => {
    expect(invalidItems([])).toBe('품목이 비어 있습니다.');
    expect(invalidItems([row({ quantity: 0 })])).toBe('품명 · 규격 · 수량이 비어 있는 행이 있습니다.');
    expect(invalidItems([row({})])).toBeNull();
  });
});

describe('작업의뢰서 상태 — 회의: 100% 생산해도 대기로 나온다', () => {
  it('수량에서 단계를 계산한다', () => {
    expect(workOrderStage('pending', { quantity: 10, produced: 0 })).toBe('waiting');
    expect(workOrderStage('pending', { quantity: 10, produced: 3 })).toBe('producing');
    expect(workOrderStage('pending', { quantity: 10, produced: 10 })).toBe('produced');
    expect(workOrderStage('in_progress', { quantity: 10, produced: 10, delivered: 4 })).toBe('delivering');
    // 납품 완료는 저장된 status(completed — statusFor 가 품목마다 따진 값)로 정한다 (2026-11-10 점검)
    expect(workOrderStage('completed', { quantity: 10, produced: 10, delivered: 10 })).toBe('delivered');
    // 재고가 함께 나가 생산보다 납품이 많아도 납품 완료
    expect(workOrderStage('completed', { quantity: 40, produced: 36, delivered: 40 })).toBe('delivered');
    // 합으로는 다 나갔어도 status 가 진행 중이면(다른 품목이 남음) 납품 중
    expect(workOrderStage('in_progress', { quantity: 20, produced: 20, delivered: 20 })).toBe('delivering');
    // 지난 의뢰서를 완료로 가져온 건 — 기록이 없어도 완료
    expect(workOrderStage('completed', { quantity: 10, produced: 0 })).toBe('done');
  });

  it('전량 납품하면 끝난 건으로 저장한다 — 생산 현황 목록에서 빠진다', () => {
    const item = (produced_quantity: number, delivered = 0, quantity = 10) => ({ quantity, produced_quantity, delivered });
    expect(statusFor([item(0)])).toBe('pending');
    expect(statusFor([item(5)])).toBe('in_progress');
    expect(statusFor([item(10)])).toBe('in_progress');
    expect(statusFor([item(10, 10)])).toBe('completed');
  });
});

describe('납품 기록', () => {
  const log = (o: Partial<DeliveryLog>): DeliveryLog => ({
    id: 'l', work_order_id: 'w', work_order_item_id: 'i', delivery_date: '2026-11-06', quantity: 1, area_m2: 1.5, note: null, ...o,
  });

  it('품목 · 의뢰서별로 더하고 날짜별로 묶는다 — 최근 날짜가 위로', () => {
    const logs = [
      log({ id: 'a', quantity: 3 }), log({ id: 'b', quantity: 2, work_order_item_id: 'j' }),
      log({ id: 'c', quantity: 4, delivery_date: '2026-11-09', work_order_id: 'x' }),
    ];
    expect(deliveredByItem(logs).get('i')).toBe(7);
    expect(deliveredByWorkOrder(logs).get('w')).toBe(5);
    const days = groupDeliveries(logs);
    expect(days.map(d => d.date)).toEqual(['2026-11-09', '2026-11-06']);
    expect(days[1]).toMatchObject({ quantity: 5, area_m2: 3 });
  });
});

describe('목록 검색 · 시각', () => {
  it('구분 기호를 빼고 세 칸을 찾는다', () => {
    expect(searchCondition('')).toBeNull();
    expect(searchCondition('  (,)  ')).toBeNull();
    expect(searchCondition('청주, 테크노')).toBe('work_order_number.ilike."%청주  테크노%",site_label.ilike."%청주  테크노%",customer_label.ilike."%청주  테크노%"');
  });

  it('수신 시각은 한국 시간으로 보인다', () => {
    expect(formatKst('2026-11-06T05:20:00.000Z')).toBe('2026-11-06 14:20');
  });
});
