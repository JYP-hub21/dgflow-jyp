-- 납품 기록 (2026-11-06)
--
-- 회의: 생산 수량을 입력하듯 납품 수량을 입력한다. 작업의뢰서 일부만 납품되는 일이 많고,
-- 한 의뢰서가 며칠에 나뉘어 나간다. 날짜는 공장 출고일이 아니라 납품일(현장에 들어가는 날) 기준이다.
-- 재고로 남아 있던 유리가 함께 나가기도 해서(36장 생산 + 4장 재고 = 40장 납품) 생산 수량을 넘겨도 막지 않는다.
--
-- 읽기: 승인된 사람 누구나 (다른 표와 같은 dgflow_read 규칙)
-- 쓰기: 정책 없음 → 서버 API(service role, 생산 입력 권한 확인)만

CREATE TABLE IF NOT EXISTS public.dgflow_delivery_logs (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id      uuid          NOT NULL REFERENCES public.dgflow_work_orders(id) ON DELETE CASCADE,
  work_order_item_id uuid          NOT NULL REFERENCES public.dgflow_work_order_items(id) ON DELETE CASCADE,
  delivery_date      date          NOT NULL,
  quantity           integer       NOT NULL CHECK (quantity > 0),
  area_m2            numeric(12,2),
  note               text,
  created_by         uuid          REFERENCES public.dgflow_users(id),
  created_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dgflow_delivery_logs_work_order
  ON public.dgflow_delivery_logs (work_order_id, delivery_date DESC);

ALTER TABLE public.dgflow_delivery_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dgflow_read ON public.dgflow_delivery_logs;
CREATE POLICY dgflow_read ON public.dgflow_delivery_logs
  FOR SELECT TO authenticated USING (dgflow_is_active_user());
