-- 주간생산일지 입력 칸 (2026-11-06)
--
-- 회사 주간생산일지 양식을 시스템에서 쓰면서, 사람이 적는 칸만 저장한다. 한 줄 = 그날 · 호기.
-- 목표 · 시간당 생산 · 환산 · 평가는 이 값과 생산 기록으로 매번 계산한다 (lib/production/weekly.ts).
-- 복층 · 3복층 칸은 비워 두면(NULL) 생산 기록 값을 쓰고, 값이 있으면 사람이 고친 값이 앞선다.
--
-- 읽기: 승인된 사람 누구나 (다른 표와 같은 dgflow_read 규칙)
-- 쓰기: 정책 없음 → 서버 API(service role, 생산 입력 권한 확인)만

CREATE TABLE IF NOT EXISTS public.dgflow_weekly_log_days (
  work_date   date          NOT NULL,
  line_number integer       NOT NULL,
  shift_type  text          NOT NULL DEFAULT '',     -- 근무 구분: 평일 · 주간연장 · 주말 · 휴무
  work_hours  numeric(5,2),                          -- 근무 시간 (실제 시간)
  barcode_qty numeric(10,2),                         -- 바코드 기준 생산량
  crew        jsonb         NOT NULL DEFAULT '{}',   -- 투입 인원 칸별 이름
  reason      text          NOT NULL DEFAULT '',     -- 사유
  double_jo   numeric(10,2),                         -- 복층 조
  double_m2   numeric(10,2),                         -- 복층 M2
  triple_jo   numeric(10,2),                         -- 3복층 조
  triple_m2   numeric(10,2),                         -- 3복층 M2
  updated_by  uuid          REFERENCES public.dgflow_users(id),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (work_date, line_number)
);

ALTER TABLE public.dgflow_weekly_log_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dgflow_read ON public.dgflow_weekly_log_days;
CREATE POLICY dgflow_read ON public.dgflow_weekly_log_days
  FOR SELECT TO authenticated USING (dgflow_is_active_user());
