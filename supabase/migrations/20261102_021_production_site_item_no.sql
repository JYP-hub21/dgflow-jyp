-- 생산 공장(오창 · 외주) · 외주 업체 · 작업의뢰서 품목 번호 (2026-11-02)
--
-- 1) 업무지원부가 작업의뢰서마다 오창공장에서 만들지, 다른 공장에 외주를 줄지 고른다.
--    외주면 어느 업체 · 누구에게 갔는지 — 공사개발부가 발주서를 보고 "어디서 만드는지, 누구에게 전화해 진행을 물을지" 안다.
--    외주 업체는 표 하나에 모아 두고 고른다 (업체명 · 담당자 · 전화).
-- 2) 품목 번호(item_no) — 종이 작업의뢰서의 NO 그대로. 예전에는 등록 화면의 줄 순서(sort_order)로만 번호를 냈다.
--    정렬을 어떻게 바꿔도 번호는 그대로여야 한다 (현장에서 "2090 에 7번" 으로 말한다).
--
-- 읽기: 승인된 사람 누구나 · 쓰기: 서버 API(service role, 권한 확인)만 — 다른 표와 같다.
-- 여러 번 실행해도 안전하다.

CREATE TABLE IF NOT EXISTS public.dgflow_outsource_partners (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  contact_name text        NOT NULL DEFAULT '',
  phone        text        NOT NULL DEFAULT '',
  memo         text        NOT NULL DEFAULT '',
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dgflow_outsource_partners_name ON public.dgflow_outsource_partners (name);

ALTER TABLE public.dgflow_outsource_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dgflow_read ON public.dgflow_outsource_partners;
CREATE POLICY dgflow_read ON public.dgflow_outsource_partners
  FOR SELECT TO authenticated USING (dgflow_is_active_user());

ALTER TABLE public.dgflow_work_orders
  ADD COLUMN IF NOT EXISTS production_site text NOT NULL DEFAULT 'ochang',
  ADD COLUMN IF NOT EXISTS outsource_partner_id uuid REFERENCES public.dgflow_outsource_partners(id);

DO $$ BEGIN
  ALTER TABLE public.dgflow_work_orders
    ADD CONSTRAINT dgflow_work_orders_production_site_check CHECK (production_site IN ('ochang', 'outsource'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.dgflow_work_order_items ADD COLUMN IF NOT EXISTS item_no integer;
-- 이미 등록된 품목은 지금 화면에 보이던 번호(등록 순서 + 1)로 채운다
UPDATE public.dgflow_work_order_items SET item_no = sort_order + 1 WHERE item_no IS NULL AND sort_order IS NOT NULL;
