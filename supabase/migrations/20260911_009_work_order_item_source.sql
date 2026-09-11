-- 작업의뢰서 품목에 "원본 발주 품명"과 "위치 요약"을 남긴다.
--
-- 규격별로 묶어서 작업의뢰서를 만들 때, 담당자가 품명을 직접 새로 적는다.
-- 그러면 발주의뢰서에 적혀 있던 원래 품명이 사라져 나중에 대조할 수 없다.
-- 원본 품명과, 몇 줄이 묶였는지, 묶인 위치들을 함께 저장해 두면
-- 원본과 작업의뢰서를 나란히 놓고 비교할 수 있다.

ALTER TABLE dgflow_work_order_items
  ADD COLUMN IF NOT EXISTS source_product_name text;   -- 발주의뢰서에 적혀 있던 품명

ALTER TABLE dgflow_work_order_items
  ADD COLUMN IF NOT EXISTS location_summary text;      -- 묶인 위치들 (302동1~3라인(1~6층)거실59A,B외창픽스)

ALTER TABLE dgflow_work_order_items
  ADD COLUMN IF NOT EXISTS source_item_count integer;  -- 발주 품목 몇 줄이 이 한 줄로 묶였는지

COMMENT ON COLUMN dgflow_work_order_items.source_product_name IS '발주의뢰서 원본 품명 — 담당자가 고쳐 쓴 품명과 대조하기 위해 보관';
