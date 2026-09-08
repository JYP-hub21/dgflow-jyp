import { describe, it, expect } from 'vitest';
import { canTransition } from '@/types/order-status';

describe('canTransition', () => {
  it('작성중 → 작성완료 가능', () => {
    expect(canTransition('draft', 'completed')).toBe(true);
  });

  it('작성중 → 고객승인대기 불가 (작성완료를 거쳐야 함)', () => {
    expect(canTransition('draft', 'pending_customer')).toBe(false);
  });

  it('작성완료 → 고객승인대기 가능', () => {
    expect(canTransition('completed', 'pending_customer')).toBe(true);
  });

  it('작성완료 → 다시 작성중(수정) 가능', () => {
    expect(canTransition('completed', 'draft')).toBe(true);
  });

  it('고객승인대기 → 고객승인완료 가능', () => {
    expect(canTransition('pending_customer', 'customer_approved')).toBe(true);
  });

  it('고객승인대기 → 반려 가능', () => {
    expect(canTransition('pending_customer', 'rejected_by_customer')).toBe(true);
  });

  it('반려-수정중 → 작성완료 가능 (수정 후 재전송)', () => {
    expect(canTransition('rejected_by_customer', 'completed')).toBe(true);
  });

  it('최종승인 → 작업의뢰서생성 가능 (자동 생성)', () => {
    expect(canTransition('final_approved', 'work_order_created')).toBe(true);
  });

  it('생산완료 → 어디로도 전이 불가', () => {
    expect(canTransition('production_completed', 'draft')).toBe(false);
  });
});
