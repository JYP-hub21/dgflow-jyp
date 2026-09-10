-- STEP 8B: 바이투 작업의뢰서 엑셀 직접 업로드 지원
-- order_id NULLABLE + 자체 거래처/현장명/소스 컬럼 추가

-- 1. order_id를 nullable로 변경 (바이투 업로드 시 주문 없이 생성)
ALTER TABLE dgflow_work_orders ALTER COLUMN order_id DROP NOT NULL;

-- 2. 자체 거래처/현장명/소스 컬럼 추가
ALTER TABLE dgflow_work_orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE dgflow_work_orders ADD COLUMN IF NOT EXISTS site_name text;
ALTER TABLE dgflow_work_orders ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'order'
  CHECK (source IN ('order', 'upload'));

-- 3. 작업의뢰서 품목에 두께 컬럼 추가
ALTER TABLE dgflow_work_order_items ADD COLUMN IF NOT EXISTS thickness numeric(8,2);

-- 기존 작업의뢰서에 source='order' 기본값 적용 (이미 DEFAULT으로 처리됨)
