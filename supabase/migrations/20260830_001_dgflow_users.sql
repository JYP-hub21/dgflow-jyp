-- DG-Flow: dgflow_users 테이블 생성
-- TASK 1-2, 1-3

CREATE TABLE dgflow_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'construction_mgr', 'biz_support', 'production_mgr', 'system_admin')),
  department text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS 활성화
ALTER TABLE dgflow_users ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 본인 정보 조회
CREATE POLICY "dgflow_users_select_own"
  ON dgflow_users FOR SELECT
  USING (auth.uid() = auth_id);

-- RLS 정책: 관리자/시스템관리자는 전체 조회
CREATE POLICY "dgflow_users_select_admin"
  ON dgflow_users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM dgflow_users u
      WHERE u.auth_id = auth.uid()
      AND u.role IN ('admin', 'system_admin')
    )
  );

-- RLS 정책: 시스템관리자만 사용자 생성/수정
CREATE POLICY "dgflow_users_insert_admin"
  ON dgflow_users FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM dgflow_users u
      WHERE u.auth_id = auth.uid()
      AND u.role = 'system_admin'
    )
  );

CREATE POLICY "dgflow_users_update_admin"
  ON dgflow_users FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM dgflow_users u
      WHERE u.auth_id = auth.uid()
      AND u.role = 'system_admin'
    )
  );

-- 경영지원팀, 생산관리팀도 전체 사용자 목록 조회 가능 (주문 배정 등)
CREATE POLICY "dgflow_users_select_staff"
  ON dgflow_users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM dgflow_users u
      WHERE u.auth_id = auth.uid()
      AND u.role IN ('biz_support', 'production_mgr', 'construction_mgr')
    )
  );

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION dgflow_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dgflow_users_updated_at
  BEFORE UPDATE ON dgflow_users
  FOR EACH ROW EXECUTE FUNCTION dgflow_update_updated_at();
