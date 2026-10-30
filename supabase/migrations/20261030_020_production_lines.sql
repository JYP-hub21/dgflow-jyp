-- 생산 라인(호기) 이름 바꾸기 · 더하기 (2026-10-30 회의)
--
-- "미니라인 등 설비가 늘 수 있으니 1호기 · 2호기로 고정하지 말고 편집할 수 있게."
-- 생산 기록은 호기 번호(line_number)만 갖고, 이름은 이 표에 둔다. 지우지 않고 is_active 로 안 쓰게 한다
-- (지난 기록이 그 번호를 쓰고 있어서). 주간 · 야간은 그대로 둔다.
--
-- 읽기: 승인된 사람 누구나 · 쓰기: 서버 API(service role, 생산 입력 또는 마스터 관리 권한)만

CREATE TABLE IF NOT EXISTS public.dgflow_production_lines (
  line_number integer     PRIMARY KEY CHECK (line_number BETWEEN 1 AND 99),
  name        text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.dgflow_production_lines (line_number, name, sort_order)
VALUES (1, '1호기', 1), (2, '2호기', 2)
ON CONFLICT (line_number) DO NOTHING;

ALTER TABLE public.dgflow_production_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dgflow_read ON public.dgflow_production_lines;
CREATE POLICY dgflow_read ON public.dgflow_production_lines
  FOR SELECT TO authenticated USING (dgflow_is_active_user());

-- 생산 기록의 호기 번호를 1 · 2 로 막던 규칙을 넓힌다 (004 에서 CREATE TABLE 안에 적어 자동 이름이 붙었다)
ALTER TABLE public.dgflow_production_logs DROP CONSTRAINT IF EXISTS dgflow_production_logs_line_number_check;
ALTER TABLE public.dgflow_production_logs
  ADD CONSTRAINT dgflow_production_logs_line_number_check CHECK (line_number BETWEEN 1 AND 99);
