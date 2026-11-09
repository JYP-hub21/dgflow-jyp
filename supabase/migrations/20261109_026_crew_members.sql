-- 생산 인원 명단 (2026-11-09)
--
-- 주간생산일지의 투입 인원 칸(투입 · 마킹 · 마감 · 간봉 · 부틸 · 밴딩)에서 사람을 골라 넣는다.
-- 사용자: "조직도 사람들 미리 학습해 두라 했잖아, 여기서 한번 쓰자 — 생산부 사람들은 크게 안 바뀐다".
-- 이름은 공개 저장소에 두지 않는다 — 이 표에만 넣는다(회사 조직도에서 서버로 넣음).
--
-- 읽기: 승인된 사람 누구나 (다른 표와 같은 dgflow_read 규칙)
-- 쓰기: 정책 없음 → 서버 API(service role, 생산 입력 권한 확인)만

CREATE TABLE IF NOT EXISTS public.dgflow_crew_members (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,            -- 일지 칸에 적히는 이름
  full_name   text        NOT NULL DEFAULT '',        -- 조직도 원문 (영문 이름 등)
  department  text        NOT NULL DEFAULT '',
  position    text        NOT NULL DEFAULT '',        -- 직급
  aliases     text[]      NOT NULL DEFAULT '{}',      -- 예전 일지에서 쓴 다른 표기 — 찾을 때만 쓴다
  sort_order  integer     NOT NULL DEFAULT 0,         -- 자주 쓰는 사람이 앞
  active      boolean     NOT NULL DEFAULT true,      -- 그만둔 사람은 지우지 않고 끈다 (지난 일지에 이름이 남아 있다)
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dgflow_crew_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dgflow_read ON public.dgflow_crew_members;
CREATE POLICY dgflow_read ON public.dgflow_crew_members
  FOR SELECT TO authenticated USING (dgflow_is_active_user());
