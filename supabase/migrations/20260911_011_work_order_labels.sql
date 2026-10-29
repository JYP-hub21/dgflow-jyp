-- 작업의뢰서에 인쇄되는 업체명·현장명은 마스터 명칭과 다르다.
--   발주서 공사명: "우미-남원주 역세권1차"
--   작업의뢰서 현장명: "남원주 역세권 복합용지 AC-4BL 우미린 공동주택현장"
-- 동일유리가 손으로 고치는 값이라 작업의뢰서마다 따로 들고 있어야 한다.
ALTER TABLE dgflow_work_orders
  ADD COLUMN IF NOT EXISTS customer_label TEXT,
  ADD COLUMN IF NOT EXISTS site_label     TEXT;

-- 같은 발주서 시트로 여러 포장 단위를 만들 때 주문을 하나만 쓰기 위한 표식
ALTER TABLE dgflow_orders
  ADD COLUMN IF NOT EXISTS source_sheet TEXT;
