-- 작업의뢰서는 "포장 단위" 1개당 1장이다.
-- 발주 1건(예: 5차)에서 3동 1~3호 / 3동 4,5호 ... 식으로 여러 장이 나온다.
ALTER TABLE dgflow_work_orders
  ADD COLUMN IF NOT EXISTS packaging_group TEXT,   -- "3동 1~3호"
  ADD COLUMN IF NOT EXISTS packaging_dong  TEXT,   -- "3동"
  ADD COLUMN IF NOT EXISTS packaging_units TEXT[], -- ['1호','2호','3호']
  ADD COLUMN IF NOT EXISTS notes           TEXT;   -- 상단 지시문(발주서별포장 / 규격별 첫장만 라벨 등)

-- 같은 주문에서 같은 포장 단위를 두 번 만들지 않는다
CREATE UNIQUE INDEX IF NOT EXISTS dgflow_work_orders_order_packaging_uniq
  ON dgflow_work_orders (order_id, packaging_group)
  WHERE packaging_group IS NOT NULL;

-- 발주서 상단의 포장 지시 문구를 주문에 보관한다 (작업의뢰서 후보를 뽑는 근거)
ALTER TABLE dgflow_orders
  ADD COLUMN IF NOT EXISTS packaging_note TEXT;
