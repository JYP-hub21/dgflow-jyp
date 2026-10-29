import { describe, it, expect } from 'vitest';
import { buildDailyReport, daysBetween, isIsoDate, weekdayOf, type ProductionLogRow } from '@/lib/production/daily-report';

function log(p: Partial<ProductionLogRow>): ProductionLogRow {
  return {
    production_date: '2026-10-13',
    quantity_completed: 1,
    area_m2: 1,
    shift: 'day',
    line_number: 1,
    work_order_id: 'wo-a',
    work_order_item_id: 'item-1',
    work_order_number: '26-2573',
    customer: '서해종합건설',
    site: '울산태화강변',
    product_name: '24T 5SKN176IIh/s+14단열(Ar.)+5CLh/s',
    width_mm: 640,
    height_mm: 2355,
    sort_order: 1,
    created_by_name: '김경영',
    ...p,
  };
}

describe('일간 생산일지 집계', () => {
  it('같은 날 같은 품목을 나눠 저장해도 한 줄로 합친다', () => {
    const r = buildDailyReport([
      log({ quantity_completed: 3, area_m2: 4.52 }),
      log({ quantity_completed: 2, area_m2: 3.01, created_by_name: '최영준' }),
    ], '2026-10-13', '2026-10-13');

    expect(r.days).toHaveLength(1);
    expect(r.days[0].lines).toHaveLength(1);
    expect(r.days[0].lines[0].quantity).toBe(5);
    expect(r.days[0].lines[0].area_m2).toBe(7.53);
    expect(r.days[0].lines[0].workers).toEqual(['김경영', '최영준']);
  });

  it('주야간·호기가 다르면 합치지 않는다 — 어느 라인에서 만들었는지 갈라 본다', () => {
    const r = buildDailyReport([
      log({ shift: 'day', line_number: 1 }),
      log({ shift: 'night', line_number: 1 }),
      log({ shift: 'day', line_number: 2 }),
    ], '2026-10-13', '2026-10-13');

    expect(r.days[0].lines).toHaveLength(3);
    expect(r.days[0].day_quantity).toBe(2);
    expect(r.days[0].night_quantity).toBe(1);
    // 주간 먼저, 그다음 호기 순
    expect(r.days[0].lines.map(l => `${l.shift}${l.line_number}`)).toEqual(['day1', 'day2', 'night1']);
  });

  it('날짜순으로 묶고 소계·총계를 낸다', () => {
    const r = buildDailyReport([
      log({ production_date: '2026-10-13', quantity_completed: 2, area_m2: 3 }),
      log({ production_date: '2026-10-06', quantity_completed: 10, area_m2: 32.82, work_order_id: 'wo-b', work_order_number: '26-2286' }),
    ], '2026-10-01', '2026-10-13');

    expect(r.days.map(d => d.date)).toEqual(['2026-10-06', '2026-10-13']);
    expect(r.quantity).toBe(12);
    expect(r.area_m2).toBe(35.82);
  });

  it('하루 안에서는 의뢰번호 → 의뢰서 품목 순서로 놓는다', () => {
    const r = buildDailyReport([
      log({ work_order_id: 'b', work_order_number: '26-2573', work_order_item_id: 'b2', sort_order: 2 }),
      log({ work_order_id: 'b', work_order_number: '26-2573', work_order_item_id: 'b1', sort_order: 1 }),
      log({ work_order_id: 'a', work_order_number: '26-2286', work_order_item_id: 'a1', sort_order: 5 }),
    ], '2026-10-13', '2026-10-13');

    expect(r.days[0].lines.map(l => l.work_order_number)).toEqual(['26-2286', '26-2573', '26-2573']);
    expect(r.days[0].work_order_count).toBe(2);
  });

  it('날짜 도우미', () => {
    expect(weekdayOf('2026-10-13')).toBe('화');
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(31);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-10-13')).toBe(true);
  });
});
