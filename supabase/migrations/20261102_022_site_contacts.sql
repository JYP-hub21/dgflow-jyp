-- 현장별 공사 담당자 (2026-11-02 사용자 요청 "현장별 공사관리부 담당자 정보 — 복층 입력할 때 있었으면")
--
-- 작업의뢰서 대부분은 ERP 에서 바로 등록해 발주 건과 이어지지 않아, '발주서 올린 사람' 으로는 담당자를 알 수 없었다.
-- 현장(작업의뢰서의 현장명)마다 공사개발부 담당자를 한 번 정해 두면, 그 현장의 작업의뢰서 전부 — 앞으로 들어올 것까지 — 에 뜬다.
-- 발주 건과 이어진 의뢰서는 여전히 그 발주서를 올린 사람이 먼저다 (lib/production/contacts.ts).
--
-- 읽기: 승인된 사람 누구나 · 쓰기: 서버 API(service role, 권한 확인)만. 여러 번 실행해도 안전하다.

CREATE TABLE IF NOT EXISTS public.dgflow_site_contacts (
  site_label  text        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES public.dgflow_users(id),
  updated_by  uuid        REFERENCES public.dgflow_users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dgflow_site_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dgflow_read ON public.dgflow_site_contacts;
CREATE POLICY dgflow_read ON public.dgflow_site_contacts
  FOR SELECT TO authenticated USING (dgflow_is_active_user());
