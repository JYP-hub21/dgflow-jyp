-- 주문 상태 목록에 '작성완료'(completed)를 추가한다.
--
-- 코드(types/order-status.ts)는 상태를 14개로 다루는데 003 마이그레이션의
-- CHECK 제약에는 13개만 들어 있었다. 그래서 '작성중 → 작성완료' 버튼을 누르면
-- DB가 거부했고, 화면은 아무 말 없이 이전 상태를 그대로 보여 주었다.
-- 제약을 코드와 같은 14개로 다시 만든다.

ALTER TABLE dgflow_orders DROP CONSTRAINT IF EXISTS dgflow_orders_status_check;

ALTER TABLE dgflow_orders ADD CONSTRAINT dgflow_orders_status_check CHECK (status IN (
  'draft',                 -- 작성중
  'completed',             -- 작성완료   ← 빠져 있던 값
  'pending_customer',      -- 고객승인대기
  'rejected_by_customer',  -- 반려-수정중
  'customer_approved',     -- 고객승인완료
  'under_review',          -- 검토중
  'review_completed',      -- 검토완료
  'pending_approval',      -- 승인대기
  'rejected_by_admin',     -- 반려-재검토
  'final_approved',        -- 최종승인
  'erp_completed',         -- ERP입력완료
  'work_order_created',    -- 작업의뢰서생성
  'in_production',         -- 생산중
  'production_completed'   -- 생산완료
));
