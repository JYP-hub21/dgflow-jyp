-- MES 생산실적 — 작업의뢰서 없이 MES 바코드 기록만으로 생산일지를 채운다 (2026-11-15)
--
-- 11/13 회의 이사님: "아무것도 없는 것보다 있는 걸 고치는 게 빠르니 MES 자료를 최대한 넣어 달라,
-- 넣어 놓고 주간생산 보고서를 회사 주간생산일지와 비교해 진짜 빠진 것만 찾자". 사용자: "이전 건은 MES 로".
-- 지난 작업의뢰서는 대부분 시스템에 없어 생산 기록(dgflow_production_logs, 의뢰서 품목에 붙는다)에 넣을 수 없다.
-- 그래서 MES 실적은 이 표에 따로 두고, 생산일지(일간 · 복층 · 주간)가 생산 기록과 함께 읽는다(lib/production/logs.ts).
--
-- 한 줄 = 그날 · 호기 · 주야간 · 의뢰번호 · NO 의 장수.
--   scanned = 바코드가 찍힌 장수
--   filled  = 같은 품목의 바코드 번호(PID) 사이가 빈 장수 — 같은 규격 여러 장은 첫 장 · 끝 장에만 라벨을 붙여(11/13 회의)
--             사이 장들이 MES 에 없다. 빈 번호는 그 뒤에 찍힌 장과 같은 날 · 호기 · 주야간에 만든 것으로 본다.
--   quantity = scanned + filled
-- 같은 파일을 다시 올리면 같은 열쇠의 줄을 덮어쓴다(두 번 세지 않는다).
--
-- 읽기: 승인된 사람 누구나 / 쓰기: 정책 없음 → 서버 API(service role, 생산 입력 권한 확인)만

CREATE TABLE IF NOT EXISTS public.dgflow_mes_production (
  production_date   date        NOT NULL,
  line_number       integer     NOT NULL,
  shift             text        NOT NULL CHECK (shift IN ('day', 'night')),
  work_order_number text        NOT NULL,
  item_no           integer     NOT NULL,
  product_name      text        NOT NULL DEFAULT '',
  width_mm          integer,
  height_mm         integer,
  customer          text        NOT NULL DEFAULT '',
  site              text        NOT NULL DEFAULT '',
  remark            text        NOT NULL DEFAULT '',
  scanned           integer     NOT NULL CHECK (scanned >= 0),
  filled            integer     NOT NULL DEFAULT 0 CHECK (filled >= 0),
  quantity          integer     NOT NULL CHECK (quantity > 0),
  area_m2           numeric(12,2) NOT NULL DEFAULT 0,
  source_file       text,
  imported_by       uuid        REFERENCES public.dgflow_users(id),
  imported_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (production_date, line_number, shift, work_order_number, item_no)
);

CREATE INDEX IF NOT EXISTS dgflow_mes_production_wo
  ON public.dgflow_mes_production (work_order_number, item_no);

ALTER TABLE public.dgflow_mes_production ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dgflow_read ON public.dgflow_mes_production;
CREATE POLICY dgflow_read ON public.dgflow_mes_production
  FOR SELECT TO authenticated USING (dgflow_is_active_user());

-- 날짜별 합계 — 복층생산일지 누계(1월 1일부터)를 한 번에 읽으려고. MES 는 복층 포장공정만이라 전부 복층이다.
CREATE OR REPLACE VIEW public.dgflow_mes_daily_totals
  WITH (security_invoker = true) AS
  SELECT production_date, sum(quantity)::integer AS quantity, sum(area_m2) AS area_m2
  FROM public.dgflow_mes_production
  GROUP BY production_date;

GRANT SELECT ON public.dgflow_mes_daily_totals TO authenticated, service_role;

-- 복층생산일지 입력 칸(종류 · 수량외)을 MES 줄에도 붙이려고 — 열쇠의 작업의뢰서 자리에 "mes:26-2573" 처럼 의뢰번호를 쓴다.
-- uuid → text 로 바꾸고 작업의뢰서 외래키는 뗀다(의뢰서를 지워도 입력값이 남는다 — 같은 날 · 같은 줄이 다시 생기면 다시 붙는다).
ALTER TABLE public.dgflow_bokcheung_entries DROP CONSTRAINT IF EXISTS dgflow_bokcheung_entries_work_order_id_fkey;
ALTER TABLE public.dgflow_bokcheung_entries ALTER COLUMN work_order_id TYPE text USING work_order_id::text;
