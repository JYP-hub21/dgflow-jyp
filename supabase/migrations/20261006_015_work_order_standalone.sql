-- 작업의뢰서는 ERP가 만든다.
--
-- 지금까지 작업의뢰서는 우리 시스템의 주문에서만 나왔다(최종승인 자동 생성, 발주서 직행).
-- 실제 업무는 반대다 — 발주서로 ERP 업로드 엑셀을 만들어 ERP에 넣으면 ERP가 작업의뢰서를
-- 뽑아 주고, 그걸 받아서 생산 수량을 적어 나간다. 지금은 종이에 손으로 적고 있다.
--
-- 그렇게 받아 온 작업의뢰서에는 대응하는 dgflow_orders 행이 없을 수 있으므로 order_id 를 푼다.
-- 주문에서 생성한 기존 경로는 그대로 order_id 를 채운다.
ALTER TABLE dgflow_work_orders ALTER COLUMN order_id DROP NOT NULL;
