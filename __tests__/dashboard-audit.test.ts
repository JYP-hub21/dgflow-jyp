import { describe, it, expect } from 'vitest';
import { doneInMonth, progressByWorkOrder } from '@/lib/dashboard/work-orders';
import { kstDateOf, kstDateTime } from '@/lib/kst-date';
import { customerDeleteText, masterErrorText, masterResultError } from '@/lib/master-data';

describe('한국 시각 (2026-11-10 점검 — 서버가 UTC 라 9시간 이르게 보였다)', () => {
  it('UTC 시각을 한국 시각 "MM/dd HH:mm" 으로', () => {
    expect(kstDateTime('2026-11-10T05:20:00+00:00')).toBe('11/10 14:20');
    expect(kstDateTime('2026-11-09T23:30:00.123456+00:00')).toBe('11/10 08:30'); // 날짜도 넘어간다
    expect(kstDateTime('2026-12-31T15:00:00Z')).toBe('01/01 00:00'); // 자정은 24 가 아니라 00
    expect(kstDateTime(new Date('2026-11-10T00:00:00Z'))).toBe('11/10 09:00');
    expect(kstDateTime('없는 날')).toBe('');
  });

  it('시각 → 한국 날짜', () => {
    expect(kstDateOf('2026-10-31T16:00:00Z')).toBe('2026-11-01');
    expect(kstDateOf('2026-10-31T14:59:00Z')).toBe('2026-10-31');
    expect(kstDateOf(null)).toBeNull();
  });
});

describe('대시보드 — 생산이 남은 작업의뢰서 (2026-11-10 점검)', () => {
  it('품목마다 덜 만든 것을 센다 — 한 품목을 더 만들어도 다른 품목의 모자람을 가리지 않는다', () => {
    const m = progressByWorkOrder([
      { work_order_id: 'w1', quantity: 10, produced_quantity: 15 },
      { work_order_id: 'w1', quantity: 10, produced_quantity: 5 },
      { work_order_id: 'w2', quantity: 4, produced_quantity: 4 },
      { work_order_id: 'w2', quantity: 6, produced_quantity: 6 },
      { work_order_id: 'w3', quantity: 1000, produced_quantity: 999 },
    ]);
    expect(m.get('w1')).toEqual({ total: 20, done: 15, remaining: 5, percent: 75, produced_all: false });
    expect(m.get('w2')).toMatchObject({ remaining: 0, percent: 100, produced_all: true }); // 납품만 남음 → 목록에서 빠진다
    expect(m.get('w3')).toMatchObject({ remaining: 1, percent: 99 }); // 덜 만든 것이 있으면 100% 로 보이지 않는다
  });

  it("'이번 달 완료' 는 접수일이 아니라 끝난 달 — 이번 달 생산 기록 또는 이번 달 연결", () => {
    const produced = new Set(['w9']);
    // 지난달 접수 · 이번 달 마지막 생산 → 센다
    expect(doneInMonth({ work_order_ids: ['w1', 'w9'], last_linked_at: '2026-10-20T01:00:00Z' }, '2026-11-01', produced)).toBe(true);
    // 다 만든 의뢰서를 이번 달(한국 날짜 11/01 00:30)에 이었다 → 센다
    expect(doneInMonth({ work_order_ids: ['w2'], last_linked_at: '2026-10-31T15:30:00Z' }, '2026-11-01', produced)).toBe(true);
    // 지난달에 끝났다 → 안 센다
    expect(doneInMonth({ work_order_ids: ['w3'], last_linked_at: '2026-10-31T14:00:00Z' }, '2026-11-01', produced)).toBe(false);
    expect(doneInMonth({ work_order_ids: [], last_linked_at: null }, '2026-11-01', produced)).toBe(false);
  });
});

describe('마스터 관리 저장 · 삭제 결과 (2026-11-10 점검)', () => {
  it('DB 오류를 사람이 읽을 말로 — 제품코드 중복 · 다른 자료가 쓰는 항목', () => {
    expect(masterErrorText({ code: '23505', message: 'duplicate key' }, '저장', '제품코드 "A1" 가 이미 있습니다.')).toBe('제품코드 "A1" 가 이미 있습니다.');
    expect(masterErrorText({ code: '23503', message: 'fk' }, '삭제')).toContain('삭제할 수 없습니다');
    expect(masterErrorText({ code: 'XX000', message: 'boom' }, '저장')).toBe('저장하지 못했습니다: boom');
  });

  it('오류 없이 0줄이면(권한 · 이미 지워짐) 실패로 친다', () => {
    expect(masterResultError({ data: [{ id: '1' }], error: null }, '저장')).toBeNull();
    expect(masterResultError({ data: [], error: null }, '삭제')).toContain('삭제되지 않았습니다');
    expect(masterResultError({ data: null, error: { code: '42501', message: 'rls' } }, '저장')).toContain('권한');
  });

  it('거래처 삭제 확인 글에 함께 지워질 현장 수와 이름', () => {
    expect(customerDeleteText('우미건설', 0)).toBe('"우미건설" 거래처를 삭제하시겠습니까?');
    const t = customerDeleteText('우미건설', 7, ['남원주', '부산장안', 'a', 'b', 'c']);
    expect(t).toContain('현장 7곳도 함께 삭제됩니다');
    expect(t).toContain('(남원주, 부산장안, a, b, c 외 2곳)');
  });
});
