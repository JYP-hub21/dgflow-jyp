-- ============================================================================
-- 사용자 Supabase(dgflow-jyp)를 팀원 dg-flow 최신본(2026-10-22) 스키마로 올리는 SQL
--
-- 언제 쓰나: Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 을 한 번 누른다.
-- 한 번만 실행한다.
--
-- 이 DB 에 이미 들어가 있는 것: 기본 001~006 + 예전 내 007(작업의뢰서 업로드)·008(작성완료 상태)·
-- 009(원본 품명). 아래는 팀원 저장소의 007~018 을 순서대로 이어 붙인 것이다.
-- 예전 내 007~009 가 만든 열은 남지만 팀원 코드가 쓰지 않아 문제없다.
--
-- 전체를 BEGIN … COMMIT 으로 감쌌다. 중간에 하나라도 실패하면 전부 취소되고 DB 는 그대로다.
--
-- 실행 뒤 로그인: 아이디 admin / 비밀번호 dgflow2026!  (이메일이 아니라 아이디로 들어간다)
-- 기존 테스트 계정 8개는 권한 없는 사원(staff)이 된다. 사용자 관리에서 정리하면 된다.
-- ============================================================================

BEGIN;


-- ---------------------------------------------------------------------------
-- 20260908_007_exec_sql.sql
-- ---------------------------------------------------------------------------
-- exec_sql: 개발용 SELECT 실행 RPC (scripts/db.mjs 에서 사용)
-- 이전 프로젝트에서는 수동 생성되어 마이그레이션에 누락돼 있었음.
-- service_role 전용 — anon/authenticated 에는 절대 노출하지 않는다.

CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', query)
  INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION exec_sql(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION exec_sql(text) TO service_role;


-- ---------------------------------------------------------------------------
-- 20260911_008_add_completed_status.sql
-- ---------------------------------------------------------------------------
-- 주문 상태 CHECK 제약에 'completed'(작성완료) 누락 보정
-- types/order-status.ts 는 14단계를 정의하지만 003_orders.sql 의 제약에는
-- 'completed' 가 빠져 있어 draft → completed 전이가 23514 로 실패했다.
ALTER TABLE dgflow_orders DROP CONSTRAINT IF EXISTS dgflow_orders_status_check;

ALTER TABLE dgflow_orders ADD CONSTRAINT dgflow_orders_status_check
  CHECK (status IN (
    'draft',
    'completed',
    'pending_customer',
    'rejected_by_customer',
    'customer_approved',
    'under_review',
    'review_completed',
    'pending_approval',
    'rejected_by_admin',
    'final_approved',
    'erp_completed',
    'work_order_created',
    'in_production',
    'production_completed'
  ));


-- ---------------------------------------------------------------------------
-- 20260911_009_work_order_packaging.sql
-- ---------------------------------------------------------------------------
-- 작업의뢰서는 "포장 단위" 1개당 1장이다.
-- 발주 1건(예: 5차)에서 3동 1~3호 / 3동 4,5호 ... 식으로 여러 장이 나온다.
ALTER TABLE dgflow_work_orders
  ADD COLUMN IF NOT EXISTS packaging_group TEXT,   -- "3동 1~3호"
  ADD COLUMN IF NOT EXISTS packaging_dong  TEXT,   -- "3동"
  ADD COLUMN IF NOT EXISTS packaging_units TEXT[], -- ['1호','2호','3호']
  ADD COLUMN IF NOT EXISTS notes           TEXT;   -- 상단 지시문(발주서별포장 / 규격별 첫장만 라벨 등)

-- 같은 주문에서 같은 포장 단위를 두 번 만들지 않는다
CREATE UNIQUE INDEX IF NOT EXISTS dgflow_work_orders_order_packaging_uniq
  ON dgflow_work_orders (order_id, packaging_group)
  WHERE packaging_group IS NOT NULL;

-- 발주서 상단의 포장 지시 문구를 주문에 보관한다 (작업의뢰서 후보를 뽑는 근거)
ALTER TABLE dgflow_orders
  ADD COLUMN IF NOT EXISTS packaging_note TEXT;


-- ---------------------------------------------------------------------------
-- 20260911_010_work_order_area.sql
-- ---------------------------------------------------------------------------
-- 작업의뢰서 면적은 발주서 면적과 계산 규칙이 다르다.
--   발주서(생성 컬럼): 가로*세로*수량/1,000,000  → 1719*1820*15 = 46.9287
--   작업의뢰서(실제 양식): round(가로*세로/1,000,000, 2) * 수량 → 3.13*15 = 46.95
-- 생성 컬럼으로는 후자를 담을 수 없어 일반 컬럼으로 바꾸고, 기존 행은 새 규칙으로 채운다.
ALTER TABLE dgflow_work_order_items DROP COLUMN IF EXISTS area_m2;
ALTER TABLE dgflow_work_order_items ADD COLUMN area_m2 NUMERIC(12,2);

UPDATE dgflow_work_order_items
   SET area_m2 = round(width_mm::numeric * height_mm::numeric / 1000000, 2) * quantity;


-- ---------------------------------------------------------------------------
-- 20260911_011_work_order_labels.sql
-- ---------------------------------------------------------------------------
-- 작업의뢰서에 인쇄되는 업체명·현장명은 마스터 명칭과 다르다.
--   발주서 공사명: "우미-남원주 역세권1차"
--   작업의뢰서 현장명: "남원주 역세권 복합용지 AC-4BL 우미린 공동주택현장"
-- 동일유리가 손으로 고치는 값이라 작업의뢰서마다 따로 들고 있어야 한다.
ALTER TABLE dgflow_work_orders
  ADD COLUMN IF NOT EXISTS customer_label TEXT,
  ADD COLUMN IF NOT EXISTS site_label     TEXT;

-- 같은 발주서 시트로 여러 포장 단위를 만들 때 주문을 하나만 쓰기 위한 표식
ALTER TABLE dgflow_orders
  ADD COLUMN IF NOT EXISTS source_sheet TEXT;


-- ---------------------------------------------------------------------------
-- 20260918_012_master_role.sql
-- ---------------------------------------------------------------------------
-- 역할 체계 단순화: 5개 역할 → master / staff
--
-- 기존 역할(admin, construction_mgr, biz_support, production_mgr, system_admin)은
-- 권한이 코드에 하드코딩되어 운영 중 조정할 수 없었다.
-- 이제 전권을 가진 master 하나와 일반 staff 만 두고,
-- 세부 기능 권한은 사원별로 부여한다 (lib/auth/role-guard.ts 의 PERMISSION_GROUPS).

-- 1) 기존 CHECK 제약 제거 (새 값으로 UPDATE 하려면 먼저 풀어야 한다)
ALTER TABLE dgflow_users DROP CONSTRAINT IF EXISTS dgflow_users_role_check;

-- 2) 마스터 계정 지정 후 나머지는 사원으로
UPDATE dgflow_users SET role = 'master' WHERE email = 'admin@dgflow.kr';
UPDATE dgflow_users SET role = 'staff'  WHERE role <> 'master';

-- 3) 새 CHECK 제약
ALTER TABLE dgflow_users
  ADD CONSTRAINT dgflow_users_role_check CHECK (role IN ('master', 'staff'));

-- 4) 옛 역할 이름을 참조하던 RLS 정책 교체
--
-- 아래 4개 정책은 role IN ('biz_support', 'production_mgr', 'system_admin') 를 검사했다.
-- 역할 값이 바뀌면 조건이 영구히 거짓이 되어 작업의뢰서/생산실적 쓰기가 전부 막힌다.
-- 나머지 테이블과 동일하게 "인증된 사용자" 로 단순화하고,
-- 실제 기능 권한은 애플리케이션 계층(role-guard)에서 판정한다.
-- (dgflow_users 를 서브쿼리로 조회하면 RLS 무한 재귀도 발생한다 — 20260831_005 참고)

DROP POLICY IF EXISTS "dgflow_wo_modify" ON dgflow_work_orders;
CREATE POLICY "dgflow_wo_modify_authenticated" ON dgflow_work_orders
  FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dgflow_woi_modify" ON dgflow_work_order_items;
CREATE POLICY "dgflow_woi_modify_authenticated" ON dgflow_work_order_items
  FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dgflow_pl_modify" ON dgflow_production_logs;
CREATE POLICY "dgflow_pl_modify_authenticated" ON dgflow_production_logs
  FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dgflow_cl_modify" ON dgflow_cutting_logs;
CREATE POLICY "dgflow_cl_modify_authenticated" ON dgflow_cutting_logs
  FOR ALL USING (auth.uid() IS NOT NULL);

-- 5) dgflow_users 의 INSERT/UPDATE 정책도 system_admin 을 참조했다면 정리
--    (사용자 생성/수정은 service_role 로 처리하므로 RLS 는 단순 인증 조건으로 둔다)
DROP POLICY IF EXISTS "dgflow_users_insert_admin" ON dgflow_users;
DROP POLICY IF EXISTS "dgflow_users_update_admin" ON dgflow_users;

CREATE POLICY "dgflow_users_insert_authenticated" ON dgflow_users
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "dgflow_users_update_authenticated" ON dgflow_users
  FOR UPDATE USING (auth.uid() IS NOT NULL);


-- ---------------------------------------------------------------------------
-- 20260922_013_order_form_profiles.sql
-- ---------------------------------------------------------------------------
-- 발주서 양식 프로파일
--
-- 발주서는 거래처가 직접 만들기 때문에 양식이 제각각이고, 학습되지 않은 양식이 계속 들어온다.
-- "모든 양식을 자동으로 이해한다" 는 불가능하므로, **한 번 가르치면 기억하는** 쪽으로 간다.
--
-- 사원이 화면에서 열을 한 번 찍어 주면 여기 저장되고,
-- 같은 거래처의 다음 발주서부터는 자동으로 적용된다.
-- 동일유리 거래처는 유한하므로 몇 달이면 대부분 덮인다.

CREATE TABLE IF NOT EXISTS dgflow_order_form_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 사람이 알아보는 이름 ("KCC건설 여의도 오피스텔")
  name          text NOT NULL,

  -- 매칭 근거 --------------------------------------------------------------
  -- 발주서 상단에서 읽은 공사명·거래처명. 부분 일치로 후보를 찾는다.
  customer_hint text,
  site_hint     text,
  -- 헤더 행의 글자를 이어 붙인 지문. 거래처명을 못 읽어도 이걸로 찾는다.
  -- 예: "위치|제품명|규격|수량|평수|실리콘|비고"
  header_signature text,

  -- 지정값 ------------------------------------------------------------------
  header_row      integer,                        -- 엑셀 기준 1-based
  columns         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- ScanColumns (0-based 컬럼 인덱스)
  location_source text,                           -- location-column | remark-column | none

  -- 이 프로파일로 읽었을 때 검산이 맞았는지 — 신뢰도 표시에 쓴다
  verified_at   timestamptz,

  created_by    uuid REFERENCES dgflow_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 같은 이름을 두 번 만들지 않는다 (사원이 저장을 반복해도 덮어쓰기가 되도록)
CREATE UNIQUE INDEX IF NOT EXISTS dgflow_order_form_profiles_name_key
  ON dgflow_order_form_profiles (name);

CREATE INDEX IF NOT EXISTS dgflow_order_form_profiles_signature_idx
  ON dgflow_order_form_profiles (header_signature);

ALTER TABLE dgflow_order_form_profiles ENABLE ROW LEVEL SECURITY;

-- 다른 테이블과 같은 규칙 — dgflow_users 를 서브쿼리로 참조하면 RLS 가 무한 재귀한다.
DROP POLICY IF EXISTS dgflow_order_form_profiles_all ON dgflow_order_form_profiles;
CREATE POLICY dgflow_order_form_profiles_all ON dgflow_order_form_profiles
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);


-- ---------------------------------------------------------------------------
-- 20260922_014_site_packaging_rules.sql
-- ---------------------------------------------------------------------------
-- 현장별 포장 규칙
--
-- 발주서에 포장 단위가 알아보기 힘들게 적혀 있으면 사원이 직접 행을 골라 포장을 짠다.
-- 같은 현장의 다음 차수 발주서는 보통 같은 방식으로 포장하므로, 그 구성을 저장해 재사용한다.
--
-- 저장하는 것은 **행 번호가 아니라 기준**이다 (동·호 / 품명 블록).
-- 행 번호는 차수가 바뀌면 밀리기 때문이다. 기준을 못 뽑아낸 포장은 `kind: 'rows'` 로 남고
-- `reusable = false` 가 되어, 다음 차수에 적용되지 않는다.

CREATE TABLE IF NOT EXISTS dgflow_site_packaging_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 사람이 알아보는 이름 ("우미 남원주 — 동·호 포장")
  name          text NOT NULL,

  -- 매칭 근거 (발주서 상단에서 읽은 값)
  site_hint     text,
  customer_hint text,

  -- PackagingRuleGroup[] — lib/erp/packaging-rule.ts 참고
  groups        jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- 다음 차수에도 적용할 수 있는 규칙인지 (행 번호 고정 포장이 있으면 false)
  reusable      boolean NOT NULL DEFAULT false,

  created_by    uuid REFERENCES dgflow_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 같은 이름을 두 번 만들지 않는다 (사원이 고쳐 가며 저장할 수 있어야 한다)
CREATE UNIQUE INDEX IF NOT EXISTS dgflow_site_packaging_rules_name_key
  ON dgflow_site_packaging_rules (name);

CREATE INDEX IF NOT EXISTS dgflow_site_packaging_rules_site_idx
  ON dgflow_site_packaging_rules (site_hint);

ALTER TABLE dgflow_site_packaging_rules ENABLE ROW LEVEL SECURITY;

-- 다른 테이블과 같은 규칙 — dgflow_users 를 서브쿼리로 참조하면 RLS 가 무한 재귀한다.
DROP POLICY IF EXISTS dgflow_site_packaging_rules_all ON dgflow_site_packaging_rules;
CREATE POLICY dgflow_site_packaging_rules_all ON dgflow_site_packaging_rules
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);


-- ---------------------------------------------------------------------------
-- 20261006_015_work_order_standalone.sql
-- ---------------------------------------------------------------------------
-- 작업의뢰서는 ERP가 만든다.
--
-- 지금까지 작업의뢰서는 우리 시스템의 주문에서만 나왔다(최종승인 자동 생성, 발주서 직행).
-- 실제 업무는 반대다 — 발주서로 ERP 업로드 엑셀을 만들어 ERP에 넣으면 ERP가 작업의뢰서를
-- 뽑아 주고, 그걸 받아서 생산 수량을 적어 나간다. 지금은 종이에 손으로 적고 있다.
--
-- 그렇게 받아 온 작업의뢰서에는 대응하는 dgflow_orders 행이 없을 수 있으므로 order_id 를 푼다.
-- 주문에서 생성한 기존 경로는 그대로 order_id 를 채운다.
ALTER TABLE dgflow_work_orders ALTER COLUMN order_id DROP NOT NULL;


-- ---------------------------------------------------------------------------
-- 20261022_016_user_permissions.sql
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- 20261022_017_user_signup.sql
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- 20261022_018_purchase_orders.sql
-- ---------------------------------------------------------------------------
-- 발주 건 — 발주서가 들어온 순간부터 생산이 끝날 때까지 한 건으로 따라간다
--
-- 지금은 직원이 발주서를 메일로 담당자에게 보내고, 담당자가 ERP 업로드 엑셀을 만들어
-- 회사 ERP 에 넣고, ERP 가 뽑은 작업의뢰서를 다시 시스템에 올린다. 그 사이에
--   - 담당자가 받아 봤는지, 어디까지 했는지 아무도 모르고
--   - ERP 를 지나면 작업의뢰서가 어느 발주서에서 나왔는지 끊긴다.
--
-- 그래서 발주서를 시스템에 "접수" 하고, 그 건에
--   ① 원본 파일 ② 누가 언제 무엇을 했는지 ③ ERP 업로드 엑셀의 포장(시트)들
--   ④ 포장마다 돌아온 작업의뢰서
-- 를 붙인다. 포장 하나가 작업의뢰서 하나가 된다 (사용자 확인: 포장마다 의뢰서 1장).
--
-- 단계 중 접수 · 확인 · ERP 엑셀 완성은 여기 저장하고(stage),
-- 작업의뢰서 연결 · 생산 중 · 완료는 연결된 작업의뢰서에서 계산한다 (lib/purchase-order/stage.ts).

CREATE TABLE IF NOT EXISTS dgflow_purchase_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_number  text NOT NULL UNIQUE,            -- 접수번호 P261022-01
  customer_name  text,
  site_name      text,
  due_date       date,                            -- 납기
  memo           text,
  created_by     uuid NOT NULL REFERENCES dgflow_users(id),
  assignee_id    uuid REFERENCES dgflow_users(id), -- 등록자가 지목한 담당자
  stage          text NOT NULL DEFAULT 'submitted'
                 CHECK (stage IN ('submitted', 'checked', 'erp_ready', 'cancelled')),
  checked_at     timestamptz,                     -- 담당자가 처음 열어 본 때
  checked_by     uuid REFERENCES dgflow_users(id),
  erp_saved_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_assignee ON dgflow_purchase_orders (assignee_id, stage);
CREATE INDEX IF NOT EXISTS idx_po_created_by ON dgflow_purchase_orders (created_by);

-- 파일 — 무료 요금제는 파일 하나 50MB 라 45MB 조각으로 나눠 올린다.
-- 조각은 storage `purchase-orders/{storage_prefix}/{0000..}` 에 있다.
CREATE TABLE IF NOT EXISTS dgflow_purchase_order_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES dgflow_purchase_orders(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('order', 'erp', 'spec')),
  file_name         text NOT NULL,
  mime_type         text NOT NULL DEFAULT '',
  size_bytes        bigint NOT NULL,
  storage_prefix    text NOT NULL,
  chunk_count       integer NOT NULL,
  sheet_name        text,           -- erp/spec: 어느 차수 시트에서 만들었나
  uploaded_by       uuid REFERENCES dgflow_users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  purged_at         timestamptz     -- 공간 확보로 원본을 지운 때 (기록은 남긴다)
);
CREATE INDEX IF NOT EXISTS idx_po_files_po ON dgflow_purchase_order_files (purchase_order_id);

-- ERP 업로드 엑셀의 포장 = 시트 1장 = 작업의뢰서 1장
CREATE TABLE IF NOT EXISTS dgflow_purchase_order_packages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES dgflow_purchase_orders(id) ON DELETE CASCADE,
  sheet_name        text NOT NULL DEFAULT '',  -- 발주서 차수 시트
  seq               integer NOT NULL,
  label             text NOT NULL,             -- "3동 1~3호"
  rows              jsonb NOT NULL,            -- [{location, width_mm, height_mm, quantity}]
  total_quantity    integer NOT NULL,
  work_order_id     uuid UNIQUE REFERENCES dgflow_work_orders(id) ON DELETE SET NULL,
  linked_at         timestamptz,
  linked_by         uuid REFERENCES dgflow_users(id),
  check_result      jsonb,                     -- ERP 엑셀 ↔ 작업의뢰서 대조 결과
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_packages_po ON dgflow_purchase_order_packages (purchase_order_id, sheet_name, seq);

-- 이력 — 누가 언제 무엇을 했나 (접수 · 열람 · 다운로드 · 담당 변경 · ERP 저장 · 연결 · 취소)
CREATE TABLE IF NOT EXISTS dgflow_purchase_order_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES dgflow_purchase_orders(id) ON DELETE CASCADE,
  user_id           uuid REFERENCES dgflow_users(id),
  action            text NOT NULL,
  detail            jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_events_po ON dgflow_purchase_order_events (purchase_order_id, created_at);

-- RLS: 읽기는 발주서 권한(등록 또는 처리)이 있으면. 쓰기는 API(service role)만.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dgflow_purchase_orders', 'dgflow_purchase_order_files',
                           'dgflow_purchase_order_packages', 'dgflow_purchase_order_events']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS dgflow_read ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY dgflow_read ON public.%I FOR SELECT TO authenticated USING (dgflow_has_permission(''order:submit'') OR dgflow_has_permission(''order:process''))', t);
  END LOOP;
END $$;

-- 파일 저장소. 조각 하나가 45MB 라 한도는 무료 요금제 최대인 50MB 로 둔다.
-- 올리기 · 받기는 브라우저가 사용자 세션으로 직접 한다 (Vercel 은 요청 하나에 4.5MB 까지만 받는다).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('purchase-orders', 'purchase-orders', false, 52428800)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "po_upload" ON storage.objects;
DROP POLICY IF EXISTS "po_select" ON storage.objects;
CREATE POLICY "po_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'purchase-orders'
    AND (dgflow_has_permission('order:submit') OR dgflow_has_permission('order:process')));
CREATE POLICY "po_select" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'purchase-orders'
    AND (dgflow_has_permission('order:submit') OR dgflow_has_permission('order:process')));
-- 지우기는 서버(service role)만 — 원본 정리 기능이 쓴다


COMMIT;
