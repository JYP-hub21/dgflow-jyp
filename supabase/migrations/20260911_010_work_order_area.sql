-- 작업의뢰서 면적은 발주서 면적과 계산 규칙이 다르다.
--   발주서(생성 컬럼): 가로*세로*수량/1,000,000  → 1719*1820*15 = 46.9287
--   작업의뢰서(실제 양식): round(가로*세로/1,000,000, 2) * 수량 → 3.13*15 = 46.95
-- 생성 컬럼으로는 후자를 담을 수 없어 일반 컬럼으로 바꾸고, 기존 행은 새 규칙으로 채운다.
ALTER TABLE dgflow_work_order_items DROP COLUMN IF EXISTS area_m2;
ALTER TABLE dgflow_work_order_items ADD COLUMN area_m2 NUMERIC(12,2);

UPDATE dgflow_work_order_items
   SET area_m2 = round(width_mm::numeric * height_mm::numeric / 1000000, 2) * quantity;
