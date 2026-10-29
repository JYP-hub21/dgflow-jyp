-- 사원별 기능 권한 + DB 접근 규칙 정리
--
-- 1) 권한은 역할(master/staff)이 아니라 사용자마다 저장한다.
--    master 는 이 목록과 상관없이 전부 통과한다 (lib/auth/role-guard.ts 와 같은 규칙).
--
-- 2) 지금까지 RLS 는 "로그인만 했으면 전부" 였고, 작업의뢰서·생산 기록 몇 개는 SELECT 가
--    `true` 라 로그인하지 않아도 공개 anon 키로 읽혔다. 사용자 표도 아무나 고칠 수 있어서
--    권한을 그 표에 두면 사원이 브라우저에서 자기 권한을 올릴 수 있다.
--    회원가입을 열기 전에 막는다:
--      - 읽기: 활성 사용자만
--      - 쓰기: 그 표를 다루는 기능 권한이 있는 사용자만
--      - dgflow_users 쓰기: 브라우저에서는 불가. 서버 API(service role)로만 고친다.
--
-- 판정 함수는 SECURITY DEFINER 라 dgflow_users 의 RLS 를 거치지 않는다
-- (정책 안에서 dgflow_users 를 서브쿼리하면 무한 재귀가 나던 문제를 이렇게 피한다).

ALTER TABLE dgflow_users ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION dgflow_is_active_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM dgflow_users
    WHERE auth_id = auth.uid() AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION dgflow_has_permission(perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM dgflow_users
    WHERE auth_id = auth.uid() AND is_active
      AND (role = 'master' OR perm = ANY (permissions))
  );
$$;

CREATE OR REPLACE FUNCTION dgflow_is_master() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM dgflow_users
    WHERE auth_id = auth.uid() AND is_active AND role = 'master'
  );
$$;

-- 기존 정책을 전부 지우고 다시 건다
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename LIKE 'dgflow\_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- 읽기: 활성 사용자면 모든 표
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'dgflow\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY dgflow_read ON public.%I FOR SELECT TO authenticated USING (dgflow_is_active_user())', t);
  END LOOP;
END $$;

-- 쓰기: 표마다 그 일을 하는 권한
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- 마스터 관리 화면이 브라우저에서 바로 고친다
    ('dgflow_products',              'dgflow_has_permission(''admin:master'')'),
    ('dgflow_customers',             'dgflow_has_permission(''admin:master'')'),
    ('dgflow_sites',                 'dgflow_has_permission(''admin:master'')'),
    ('dgflow_raw_glasses',           'dgflow_has_permission(''admin:master'')'),
    ('dgflow_product_name_mappings', 'dgflow_has_permission(''admin:master'')'),
    -- 작업의뢰서 등록 + 생산 입력이 완료 수량을 고친다
    ('dgflow_work_orders',      'dgflow_has_permission(''work_order:create'') OR dgflow_has_permission(''production:input'')'),
    ('dgflow_work_order_items', 'dgflow_has_permission(''work_order:create'') OR dgflow_has_permission(''production:input'')'),
    ('dgflow_production_logs',  'dgflow_has_permission(''production:input'')'),
    ('dgflow_cutting_logs',     'dgflow_has_permission(''production:input'')'),
    ('dgflow_order_form_profiles',  'dgflow_has_permission(''erp:generate'')'),
    ('dgflow_site_packaging_rules', 'dgflow_has_permission(''erp:generate'')'),
    -- 걷어낸 주문 워크플로우의 표 — 화면이 없다
    ('dgflow_orders',            'dgflow_is_master()'),
    ('dgflow_order_items',       'dgflow_is_master()'),
    ('dgflow_order_status_logs', 'dgflow_is_master()'),
    ('dgflow_order_attachments', 'dgflow_is_master()'),
    ('dgflow_approvals',         'dgflow_is_master()'),
    ('dgflow_approval_tokens',   'dgflow_is_master()'),
    ('dgflow_notifications',     'dgflow_is_master()')
  ) AS v(tbl, cond)
  LOOP
    EXECUTE format('CREATE POLICY dgflow_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', r.tbl, r.cond);
    EXECUTE format('CREATE POLICY dgflow_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.tbl, r.cond, r.cond);
    EXECUTE format('CREATE POLICY dgflow_delete ON public.%I FOR DELETE TO authenticated USING (%s)', r.tbl, r.cond);
  END LOOP;
END $$;
-- dgflow_users 는 쓰기 정책을 두지 않는다 — /api/users 가 service role 로 고친다.

-- 첨부파일 저장소도 활성 사용자만
DROP POLICY IF EXISTS "auth_upload" ON storage.objects;
DROP POLICY IF EXISTS "auth_select" ON storage.objects;
DROP POLICY IF EXISTS "auth_delete" ON storage.objects;
CREATE POLICY "auth_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'order-attachments' AND dgflow_is_active_user());
CREATE POLICY "auth_select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'order-attachments' AND dgflow_is_active_user());
CREATE POLICY "auth_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'order-attachments' AND dgflow_is_master());
