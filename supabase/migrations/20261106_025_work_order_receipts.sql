-- 작업의뢰서 수신 확인 (2026-11-06)
--
-- 회의: 업무지원부가 올린 의뢰서를 생산관리부가 "받았다" 고 확인하고 시각까지 남아야 한다.
-- 급발주를 밤에 메일로 보내 놓고 어제 보냈다고 하는 일이 있어 공장이 받은 시각이 근거가 된다.
-- 한번 확인하면 고치지 않는다 — 이 시각이 근거 자료다.
--
-- 읽기: 승인된 사람 누구나 (다른 표와 같은 dgflow_read 규칙)
-- 쓰기: 정책 없음 → 서버 API(service role, 생산 조회 권한 확인)만

CREATE TABLE IF NOT EXISTS public.dgflow_work_order_receipts (
  work_order_id uuid        PRIMARY KEY REFERENCES public.dgflow_work_orders(id) ON DELETE CASCADE,
  received_at   timestamptz NOT NULL DEFAULT now(),
  received_by   uuid        REFERENCES public.dgflow_users(id)
);

ALTER TABLE public.dgflow_work_order_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dgflow_read ON public.dgflow_work_order_receipts;
CREATE POLICY dgflow_read ON public.dgflow_work_order_receipts
  FOR SELECT TO authenticated USING (dgflow_is_active_user());
