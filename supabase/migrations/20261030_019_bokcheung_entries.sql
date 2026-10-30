-- 복층생산일지 입력 칸 — 종류 · 수량외 (2026-10-30)
--
-- 일간 생산일지를 회사 "복층생산일지" 양식 그대로 뽑으면서, 사람이 적는 두 칸만 따로 저장한다.
-- 한 줄 = 그날 · 호기 · 작업의뢰서 · 재료종류 (lib/production/bokcheung.ts 의 rowKey 와 같은 열쇠).
-- 나머지 칸(주문번호 · 거래처 · 재료 · 두께 · AR · 크기 · 수량 · 면적)은 생산 기록에서 매번 계산한다.
--
-- 읽기: 승인된 사람 누구나 (다른 표와 같은 dgflow_read 규칙)
-- 쓰기: 정책 없음 → 서버 API(service role, 생산 입력 권한 확인)만 — 발주 건 표와 같은 방식

CREATE TABLE IF NOT EXISTS public.dgflow_bokcheung_entries (
  production_date date        NOT NULL,
  line_number     integer     NOT NULL,
  work_order_id   uuid        NOT NULL REFERENCES public.dgflow_work_orders(id) ON DELETE CASCADE,
  composition     text        NOT NULL,
  glass_type      text        NOT NULL DEFAULT '',   -- 종류: U1 · U2 · U3 · U3-1 · E5
  quantity_note   text        NOT NULL DEFAULT '',   -- 수량외: "16조외52"
  updated_by      uuid        REFERENCES public.dgflow_users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (production_date, line_number, work_order_id, composition)
);

-- 같은 재료 구성에 예전에 적은 종류를 찾아 제안할 때
CREATE INDEX IF NOT EXISTS dgflow_bokcheung_entries_composition
  ON public.dgflow_bokcheung_entries (composition, production_date DESC);

ALTER TABLE public.dgflow_bokcheung_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dgflow_read ON public.dgflow_bokcheung_entries;
CREATE POLICY dgflow_read ON public.dgflow_bokcheung_entries
  FOR SELECT TO authenticated USING (dgflow_is_active_user());
