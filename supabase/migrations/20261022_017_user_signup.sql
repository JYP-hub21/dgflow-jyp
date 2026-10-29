-- 회원가입 + 관리자 승인
--
-- 사원이 스스로 가입하고 관리자가 승인한다. 가입하면 status = 'pending' 이고,
-- 승인 전에는 로그인도 데이터 접근도 안 된다 (RLS 판정 함수가 status 를 본다).
--
-- 아이디는 회사 사람들이 쓰는 이니셜 같은 짧은 영문이다. Supabase Auth 는 이메일만
-- 받으므로 안에서는 `{아이디}@dgflow.local` 로 저장하고, 로그인은 login_id 로 찾는다.
-- 기존 계정(admin@dgflow.kr)은 이메일을 그대로 두고 login_id 만 붙인다.

ALTER TABLE dgflow_users
  ADD COLUMN IF NOT EXISTS login_id    text,
  ADD COLUMN IF NOT EXISTS phone       text,
  ADD COLUMN IF NOT EXISTS birth_date  date,
  ADD COLUMN IF NOT EXISTS position    text,
  ADD COLUMN IF NOT EXISTS status      text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES dgflow_users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE dgflow_users DROP CONSTRAINT IF EXISTS dgflow_users_status_check;
ALTER TABLE dgflow_users ADD CONSTRAINT dgflow_users_status_check
  CHECK (status IN ('pending', 'active'));

-- 기존 계정: 이메일 앞부분을 아이디로
UPDATE dgflow_users SET login_id = lower(split_part(email, '@', 1)) WHERE login_id IS NULL;

ALTER TABLE dgflow_users ALTER COLUMN login_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS dgflow_users_login_id_key ON dgflow_users (login_id);

-- 판정 함수 — 승인되지 않은 계정은 활성이 아니다
CREATE OR REPLACE FUNCTION dgflow_is_active_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM dgflow_users
    WHERE auth_id = auth.uid() AND is_active AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION dgflow_has_permission(perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM dgflow_users
    WHERE auth_id = auth.uid() AND is_active AND status = 'active'
      AND (role = 'master' OR perm = ANY (permissions))
  );
$$;

CREATE OR REPLACE FUNCTION dgflow_is_master() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM dgflow_users
    WHERE auth_id = auth.uid() AND is_active AND status = 'active' AND role = 'master'
  );
$$;
