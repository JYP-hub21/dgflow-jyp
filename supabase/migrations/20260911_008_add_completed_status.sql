-- 주문 상태 CHECK 제약에 'completed'(작성완료) 누락 보정
-- types/order-status.ts 는 14단계를 정의하지만 003_orders.sql 의 제약에는
-- 'completed' 가 빠져 있어 draft → completed 전이가 23514 로 실패했다.
ALTER TABLE dgflow_orders DROP CONSTRAINT IF EXISTS dgflow_orders_status_check;

ALTER TABLE dgflow_orders ADD CONSTRAINT dgflow_orders_status_check
  CHECK (status IN (
    'draft',
    'completed',
    'pending_customer',
    'rejected_by_customer',
    'customer_approved',
    'under_review',
    'review_completed',
    'pending_approval',
    'rejected_by_admin',
    'final_approved',
    'erp_completed',
    'work_order_created',
    'in_production',
    'production_completed'
  ));
