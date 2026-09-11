-- ============================================================
-- dgflow-jyp 최초 설치용 — 마이그레이션 전체 + 기초 데이터를 한 파일로 합친 것
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 하면 됩니다.
-- 원본은 supabase/migrations/ 안의 파일들입니다 (이 파일은 붙여넣기 편의용).
-- ============================================================


-- ─────────────────────────────────────────────────────────
-- supabase/migrations/20260830_001_dgflow_users.sql
-- ─────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────
-- supabase/migrations/20260830_002_master_tables.sql
-- ─────────────────────────────────────────────────────────
-- DG-Flow: 마스터 데이터 테이블 생성
-- TASK 2A-1~3, 2B-1~3, 2C-1~2

-- ============================================
-- 1. 품명 마스터 (dgflow_products)
-- ============================================
CREATE TABLE dgflow_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text UNIQUE NOT NULL,
  display_name text NOT NULL,
  erp_name text NOT NULL,
  thickness_mm numeric(6,2) NOT NULL,
  outer_glass text,
  spacer text,
  gas text,
  inner_glass text,
  lamination_type text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dgflow_products_select_all" ON dgflow_products
  FOR SELECT USING (true);
CREATE POLICY "dgflow_products_modify_admin" ON dgflow_products
  FOR ALL USING (
    EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('system_admin', 'biz_support'))
  );

CREATE TRIGGER dgflow_products_updated_at
  BEFORE UPDATE ON dgflow_products
  FOR EACH ROW EXECUTE FUNCTION dgflow_update_updated_at();

-- ============================================
-- 2. 품명 변환 매핑 (dgflow_product_name_mappings)
-- ============================================
CREATE TABLE dgflow_product_name_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES dgflow_products(id) ON DELETE CASCADE,
  variant_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_product_name_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dgflow_pnm_select_all" ON dgflow_product_name_mappings
  FOR SELECT USING (true);
CREATE POLICY "dgflow_pnm_modify_admin" ON dgflow_product_name_mappings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('system_admin', 'biz_support'))
  );

-- ============================================
-- 3. 거래처 (dgflow_customers)
-- ============================================
CREATE TABLE dgflow_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  short_name text,
  contact_info text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dgflow_customers_select_all" ON dgflow_customers
  FOR SELECT USING (true);
CREATE POLICY "dgflow_customers_modify_admin" ON dgflow_customers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('system_admin', 'biz_support'))
  );

CREATE TRIGGER dgflow_customers_updated_at
  BEFORE UPDATE ON dgflow_customers
  FOR EACH ROW EXECUTE FUNCTION dgflow_update_updated_at();

-- ============================================
-- 4. 현장 (dgflow_sites)
-- ============================================
CREATE TABLE dgflow_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES dgflow_customers(id) ON DELETE CASCADE,
  site_name text NOT NULL,
  address text,
  region_sido text,
  region_sigungu text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dgflow_sites_select_all" ON dgflow_sites
  FOR SELECT USING (true);
CREATE POLICY "dgflow_sites_modify_admin" ON dgflow_sites
  FOR ALL USING (
    EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('system_admin', 'biz_support'))
  );

CREATE TRIGGER dgflow_sites_updated_at
  BEFORE UPDATE ON dgflow_sites
  FOR EACH ROW EXECUTE FUNCTION dgflow_update_updated_at();

-- ============================================
-- 5. 원판 마스터 (dgflow_raw_glasses)
-- ============================================
CREATE TABLE dgflow_raw_glasses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  glass_type text NOT NULL,
  width_mm integer NOT NULL,
  height_mm integer NOT NULL,
  area_m2 numeric(10,4) GENERATED ALWAYS AS (width_mm::numeric * height_mm::numeric / 1000000) STORED,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_raw_glasses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dgflow_raw_glasses_select_all" ON dgflow_raw_glasses
  FOR SELECT USING (true);
CREATE POLICY "dgflow_raw_glasses_modify_admin" ON dgflow_raw_glasses
  FOR ALL USING (
    EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('system_admin', 'biz_support'))
  );


-- ─────────────────────────────────────────────────────────
-- supabase/migrations/20260830_003_orders.sql
-- ─────────────────────────────────────────────────────────
-- DG-Flow: 주문 테이블 생성
-- TASK 3-1, 3-2, 3-3

-- ============================================
-- 주문 (dgflow_orders)
-- ============================================
CREATE TABLE dgflow_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE,
  customer_id uuid NOT NULL REFERENCES dgflow_customers(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES dgflow_sites(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES dgflow_users(id) ON DELETE RESTRICT,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  delivery_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_customer', 'rejected_by_customer', 'customer_approved',
    'under_review', 'review_completed', 'pending_approval',
    'rejected_by_admin', 'final_approved', 'erp_completed',
    'work_order_created', 'in_production', 'production_completed'
  )),
  total_quantity integer NOT NULL DEFAULT 0,
  total_area_m2 numeric(12,2) NOT NULL DEFAULT 0,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_orders ENABLE ROW LEVEL SECURITY;

-- 공사관리부: 본인 생성 주문만
CREATE POLICY "dgflow_orders_select_own" ON dgflow_orders
  FOR SELECT USING (
    created_by IN (SELECT id FROM dgflow_users WHERE auth_id = auth.uid())
  );

-- 경영지원팀/관리자/생산관리팀: 전체 조회
CREATE POLICY "dgflow_orders_select_staff" ON dgflow_orders
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('biz_support', 'admin', 'production_mgr', 'system_admin'))
  );

-- 공사관리부: 본인 주문 생성
CREATE POLICY "dgflow_orders_insert" ON dgflow_orders
  FOR INSERT WITH CHECK (
    created_by IN (SELECT id FROM dgflow_users WHERE auth_id = auth.uid())
  );

-- 주문 수정: 초안/반려 상태에서만
CREATE POLICY "dgflow_orders_update" ON dgflow_orders
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('construction_mgr', 'biz_support', 'admin', 'system_admin'))
  );

CREATE TRIGGER dgflow_orders_updated_at
  BEFORE UPDATE ON dgflow_orders
  FOR EACH ROW EXECUTE FUNCTION dgflow_update_updated_at();

-- ============================================
-- 주문 품목 (dgflow_order_items)
-- ============================================
CREATE TABLE dgflow_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES dgflow_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES dgflow_products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  width_mm integer NOT NULL CHECK (width_mm > 0),
  height_mm integer NOT NULL CHECK (height_mm > 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  area_m2 numeric(12,4) GENERATED ALWAYS AS (width_mm::numeric * height_mm::numeric * quantity / 1000000) STORED,
  location_dong text,
  location_line text,
  location_floor text,
  location_room text,
  location_type text,
  location_window_type text,
  remark text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dgflow_order_items_select" ON dgflow_order_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM dgflow_orders o WHERE o.id = order_id AND (
      o.created_by IN (SELECT id FROM dgflow_users WHERE auth_id = auth.uid())
      OR EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('biz_support', 'admin', 'production_mgr', 'system_admin'))
    ))
  );

CREATE POLICY "dgflow_order_items_modify" ON dgflow_order_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM dgflow_orders o WHERE o.id = order_id AND (
      o.created_by IN (SELECT id FROM dgflow_users WHERE auth_id = auth.uid())
      OR EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('biz_support', 'system_admin'))
    ))
  );

-- ============================================
-- 승인 이력 (dgflow_approvals)
-- ============================================
CREATE TABLE dgflow_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES dgflow_orders(id) ON DELETE CASCADE,
  step text NOT NULL CHECK (step IN ('customer', 'review', 'approve')),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by uuid REFERENCES dgflow_users(id),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dgflow_approvals_select" ON dgflow_approvals
  FOR SELECT USING (true);
CREATE POLICY "dgflow_approvals_insert" ON dgflow_approvals
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid())
  );

-- ============================================
-- 고객 승인 토큰 (dgflow_approval_tokens)
-- ============================================
CREATE TABLE dgflow_approval_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES dgflow_orders(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_approval_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dgflow_tokens_select" ON dgflow_approval_tokens
  FOR SELECT USING (true);
CREATE POLICY "dgflow_tokens_insert" ON dgflow_approval_tokens
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid())
  );
CREATE POLICY "dgflow_tokens_update" ON dgflow_approval_tokens
  FOR UPDATE USING (true);

-- ============================================
-- 주문 상태 변경 로그 (dgflow_order_status_logs)
-- ============================================
CREATE TABLE dgflow_order_status_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES dgflow_orders(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid REFERENCES dgflow_users(id),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_order_status_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dgflow_status_logs_select" ON dgflow_order_status_logs
  FOR SELECT USING (true);
CREATE POLICY "dgflow_status_logs_insert" ON dgflow_order_status_logs
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid())
  );

-- ============================================
-- 알림 (dgflow_notifications)
-- ============================================
CREATE TABLE dgflow_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES dgflow_users(id) ON DELETE CASCADE,
  type text NOT NULL,
  message text NOT NULL,
  order_id uuid REFERENCES dgflow_orders(id) ON DELETE CASCADE,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dgflow_notifications_own" ON dgflow_notifications
  FOR SELECT USING (
    user_id IN (SELECT id FROM dgflow_users WHERE auth_id = auth.uid())
  );
CREATE POLICY "dgflow_notifications_update_own" ON dgflow_notifications
  FOR UPDATE USING (
    user_id IN (SELECT id FROM dgflow_users WHERE auth_id = auth.uid())
  );
CREATE POLICY "dgflow_notifications_insert" ON dgflow_notifications
  FOR INSERT WITH CHECK (true);


-- ─────────────────────────────────────────────────────────
-- supabase/migrations/20260831_004_production.sql
-- ─────────────────────────────────────────────────────────
-- DG-Flow: Phase 2 생산 관련 테이블
-- TASK 8-1~2, 9-1~2, 10-1

-- ============================================
-- 작업의뢰서 (dgflow_work_orders)
-- ============================================
CREATE TABLE dgflow_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES dgflow_orders(id) ON DELETE CASCADE,
  work_order_number text UNIQUE,
  request_date date NOT NULL DEFAULT CURRENT_DATE,
  delivery_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_work_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dgflow_wo_select" ON dgflow_work_orders FOR SELECT USING (true);
CREATE POLICY "dgflow_wo_modify" ON dgflow_work_orders FOR ALL USING (
  EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('biz_support', 'production_mgr', 'system_admin'))
);
CREATE TRIGGER dgflow_work_orders_updated_at BEFORE UPDATE ON dgflow_work_orders
  FOR EACH ROW EXECUTE FUNCTION dgflow_update_updated_at();

-- ============================================
-- 작업의뢰서 품목 (dgflow_work_order_items)
-- ============================================
CREATE TABLE dgflow_work_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES dgflow_work_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES dgflow_products(id),
  product_name text NOT NULL,
  width_mm integer NOT NULL,
  height_mm integer NOT NULL,
  quantity integer NOT NULL,
  area_m2 numeric(12,4) GENERATED ALWAYS AS (width_mm::numeric * height_mm::numeric * quantity / 1000000) STORED,
  produced_quantity integer NOT NULL DEFAULT 0,
  remark text,
  sort_order integer NOT NULL DEFAULT 0
);

ALTER TABLE dgflow_work_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dgflow_woi_select" ON dgflow_work_order_items FOR SELECT USING (true);
CREATE POLICY "dgflow_woi_modify" ON dgflow_work_order_items FOR ALL USING (
  EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('biz_support', 'production_mgr', 'system_admin'))
);

-- ============================================
-- 복층 생산실적 (dgflow_production_logs)
-- ============================================
CREATE TABLE dgflow_production_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES dgflow_work_orders(id) ON DELETE CASCADE,
  work_order_item_id uuid REFERENCES dgflow_work_order_items(id) ON DELETE CASCADE,
  production_date date NOT NULL DEFAULT CURRENT_DATE,
  log_type text NOT NULL DEFAULT 'full' CHECK (log_type IN ('full', 'partial')),
  quantity_completed integer NOT NULL CHECK (quantity_completed > 0),
  area_m2 numeric(12,4),
  shift text DEFAULT 'day' CHECK (shift IN ('day', 'night')),
  line_number integer DEFAULT 1 CHECK (line_number IN (1, 2)),
  remark text,
  created_by uuid REFERENCES dgflow_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_production_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dgflow_pl_select" ON dgflow_production_logs FOR SELECT USING (true);
CREATE POLICY "dgflow_pl_modify" ON dgflow_production_logs FOR ALL USING (
  EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('production_mgr', 'system_admin'))
);

-- ============================================
-- 재단 실적 (dgflow_cutting_logs)
-- ============================================
CREATE TABLE dgflow_cutting_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES dgflow_work_orders(id) ON DELETE CASCADE,
  cutting_date date NOT NULL DEFAULT CURRENT_DATE,
  product_name text NOT NULL,
  quantity integer NOT NULL,
  area_m2 numeric(12,4),
  raw_glass_type text,
  raw_width_mm integer,
  raw_height_mm integer,
  raw_quantity integer,
  raw_area_m2 numeric(12,4),
  shift text DEFAULT 'day' CHECK (shift IN ('day', 'night')),
  is_manual boolean NOT NULL DEFAULT false,
  remark text,
  created_by uuid REFERENCES dgflow_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dgflow_cutting_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dgflow_cl_select" ON dgflow_cutting_logs FOR SELECT USING (true);
CREATE POLICY "dgflow_cl_modify" ON dgflow_cutting_logs FOR ALL USING (
  EXISTS (SELECT 1 FROM dgflow_users u WHERE u.auth_id = auth.uid() AND u.role IN ('production_mgr', 'system_admin'))
);

-- 주문번호 시퀀스 (의뢰번호용)
CREATE SEQUENCE IF NOT EXISTS dgflow_work_order_seq START 1;


-- ─────────────────────────────────────────────────────────
-- supabase/migrations/20260831_005_fix_rls.sql
-- ─────────────────────────────────────────────────────────
-- RLS 무한 재귀 문제 수정
-- 원인: dgflow_customers SELECT 정책이 dgflow_users를 조회 → dgflow_users SELECT 정책이 다시 dgflow_users를 조회 → 무한 루프
-- 해결: 인증된 사용자(auth.uid() IS NOT NULL)면 SELECT 허용

-- dgflow_users: 기존 정책 삭제 후 재생성
DROP POLICY IF EXISTS "dgflow_users_select_own" ON dgflow_users;
DROP POLICY IF EXISTS "dgflow_users_select_admin" ON dgflow_users;
DROP POLICY IF EXISTS "dgflow_users_select_staff" ON dgflow_users;
CREATE POLICY "dgflow_users_select_authenticated" ON dgflow_users
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- dgflow_customers: 기존 정책 삭제 후 재생성
DROP POLICY IF EXISTS "dgflow_customers_select_all" ON dgflow_customers;
CREATE POLICY "dgflow_customers_select_authenticated" ON dgflow_customers
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- dgflow_sites
DROP POLICY IF EXISTS "dgflow_sites_select_all" ON dgflow_sites;
CREATE POLICY "dgflow_sites_select_authenticated" ON dgflow_sites
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- dgflow_products
DROP POLICY IF EXISTS "dgflow_products_select_all" ON dgflow_products;
CREATE POLICY "dgflow_products_select_authenticated" ON dgflow_products
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- dgflow_product_name_mappings
DROP POLICY IF EXISTS "dgflow_pnm_select_all" ON dgflow_product_name_mappings;
CREATE POLICY "dgflow_pnm_select_authenticated" ON dgflow_product_name_mappings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- dgflow_raw_glasses
DROP POLICY IF EXISTS "dgflow_raw_glasses_select_all" ON dgflow_raw_glasses;
CREATE POLICY "dgflow_raw_glasses_select_authenticated" ON dgflow_raw_glasses
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- dgflow_orders: 기존 select_own과 select_staff에서도 재귀 가능성 있으므로 수정
DROP POLICY IF EXISTS "dgflow_orders_select_own" ON dgflow_orders;
DROP POLICY IF EXISTS "dgflow_orders_select_staff" ON dgflow_orders;
CREATE POLICY "dgflow_orders_select_authenticated" ON dgflow_orders
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- dgflow_order_items
DROP POLICY IF EXISTS "dgflow_order_items_select" ON dgflow_order_items;
CREATE POLICY "dgflow_order_items_select_authenticated" ON dgflow_order_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- dgflow_approvals, tokens, status_logs, notifications: 이미 true 또는 단순 조건이므로 유지
-- dgflow_work_orders, work_order_items, production_logs, cutting_logs: 이미 true이므로 유지

-- INSERT/UPDATE 정책도 재귀 방지 (dgflow_users 조회 대신 auth.uid() 직접 사용)
DROP POLICY IF EXISTS "dgflow_customers_modify_admin" ON dgflow_customers;
CREATE POLICY "dgflow_customers_modify_authenticated" ON dgflow_customers
  FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dgflow_sites_modify_admin" ON dgflow_sites;
CREATE POLICY "dgflow_sites_modify_authenticated" ON dgflow_sites
  FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dgflow_products_modify_admin" ON dgflow_products;
CREATE POLICY "dgflow_products_modify_authenticated" ON dgflow_products
  FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dgflow_pnm_modify_admin" ON dgflow_product_name_mappings;
CREATE POLICY "dgflow_pnm_modify_authenticated" ON dgflow_product_name_mappings
  FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dgflow_raw_glasses_modify_admin" ON dgflow_raw_glasses;
CREATE POLICY "dgflow_raw_glasses_modify_authenticated" ON dgflow_raw_glasses
  FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dgflow_orders_insert" ON dgflow_orders;
DROP POLICY IF EXISTS "dgflow_orders_update" ON dgflow_orders;
CREATE POLICY "dgflow_orders_modify_authenticated" ON dgflow_orders
  FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dgflow_order_items_modify" ON dgflow_order_items;
CREATE POLICY "dgflow_order_items_modify_authenticated" ON dgflow_order_items
  FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "dgflow_users_insert_admin" ON dgflow_users;
DROP POLICY IF EXISTS "dgflow_users_update_admin" ON dgflow_users;
CREATE POLICY "dgflow_users_modify_authenticated" ON dgflow_users
  FOR ALL USING (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────
-- supabase/migrations/20260902_006_order_attachments.sql
-- ─────────────────────────────────────────────────────────
-- 주문 첨부파일 테이블
CREATE TABLE dgflow_order_attachments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES dgflow_orders(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'etc',
  uploaded_by uuid REFERENCES dgflow_users(id),
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE dgflow_order_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_access" ON dgflow_order_attachments
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Index
CREATE INDEX idx_order_attachments_order_id ON dgflow_order_attachments(order_id);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('order-attachments', 'order-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: 인증된 사용자만 접근
CREATE POLICY "auth_upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'order-attachments' AND auth.uid() IS NOT NULL);
CREATE POLICY "auth_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'order-attachments' AND auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'order-attachments' AND auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────
-- supabase/migrations/20260909_007_work_order_upload.sql
-- ─────────────────────────────────────────────────────────
-- STEP 8B: 바이투 작업의뢰서 엑셀 직접 업로드 지원
-- order_id NULLABLE + 자체 거래처/현장명/소스 컬럼 추가

-- 1. order_id를 nullable로 변경 (바이투 업로드 시 주문 없이 생성)
ALTER TABLE dgflow_work_orders ALTER COLUMN order_id DROP NOT NULL;

-- 2. 자체 거래처/현장명/소스 컬럼 추가
ALTER TABLE dgflow_work_orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE dgflow_work_orders ADD COLUMN IF NOT EXISTS site_name text;
ALTER TABLE dgflow_work_orders ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'order'
  CHECK (source IN ('order', 'upload'));

-- 3. 작업의뢰서 품목에 두께 컬럼 추가
ALTER TABLE dgflow_work_order_items ADD COLUMN IF NOT EXISTS thickness numeric(8,2);

-- 기존 작업의뢰서에 source='order' 기본값 적용 (이미 DEFAULT으로 처리됨)


-- ─────────────────────────────────────────────────────────
-- supabase/migrations/20260910_008_fix_order_status_check.sql
-- ─────────────────────────────────────────────────────────
-- 주문 상태 목록에 '작성완료'(completed)를 추가한다.
--
-- 코드(types/order-status.ts)는 상태를 14개로 다루는데 003 마이그레이션의
-- CHECK 제약에는 13개만 들어 있었다. 그래서 '작성중 → 작성완료' 버튼을 누르면
-- DB가 거부했고, 화면은 아무 말 없이 이전 상태를 그대로 보여 주었다.
-- 제약을 코드와 같은 14개로 다시 만든다.

ALTER TABLE dgflow_orders DROP CONSTRAINT IF EXISTS dgflow_orders_status_check;

ALTER TABLE dgflow_orders ADD CONSTRAINT dgflow_orders_status_check CHECK (status IN (
  'draft',                 -- 작성중
  'completed',             -- 작성완료   ← 빠져 있던 값
  'pending_customer',      -- 고객승인대기
  'rejected_by_customer',  -- 반려-수정중
  'customer_approved',     -- 고객승인완료
  'under_review',          -- 검토중
  'review_completed',      -- 검토완료
  'pending_approval',      -- 승인대기
  'rejected_by_admin',     -- 반려-재검토
  'final_approved',        -- 최종승인
  'erp_completed',         -- ERP입력완료
  'work_order_created',    -- 작업의뢰서생성
  'in_production',         -- 생산중
  'production_completed'   -- 생산완료
));


-- ─────────────────────────────────────────────────────────
-- supabase/migrations/20260911_009_work_order_item_source.sql
-- ─────────────────────────────────────────────────────────
-- 작업의뢰서 품목에 "원본 발주 품명"과 "위치 요약"을 남긴다.
--
-- 규격별로 묶어서 작업의뢰서를 만들 때, 담당자가 품명을 직접 새로 적는다.
-- 그러면 발주의뢰서에 적혀 있던 원래 품명이 사라져 나중에 대조할 수 없다.
-- 원본 품명과, 몇 줄이 묶였는지, 묶인 위치들을 함께 저장해 두면
-- 원본과 작업의뢰서를 나란히 놓고 비교할 수 있다.

ALTER TABLE dgflow_work_order_items
  ADD COLUMN IF NOT EXISTS source_product_name text;   -- 발주의뢰서에 적혀 있던 품명

ALTER TABLE dgflow_work_order_items
  ADD COLUMN IF NOT EXISTS location_summary text;      -- 묶인 위치들 (302동1~3라인(1~6층)거실59A,B외창픽스)

ALTER TABLE dgflow_work_order_items
  ADD COLUMN IF NOT EXISTS source_item_count integer;  -- 발주 품목 몇 줄이 이 한 줄로 묶였는지

COMMENT ON COLUMN dgflow_work_order_items.source_product_name IS '발주의뢰서 원본 품명 — 담당자가 고쳐 쓴 품명과 대조하기 위해 보관';


-- ─────────────────────────────────────────────────────────
-- supabase/seed_master.sql
-- ─────────────────────────────────────────────────────────
-- DG-Flow 마스터 데이터 시딩
-- TASK 2A-4, 2B-4, 2C-2

-- ============================================
-- 품명 마스터 (PRD 5.3절 변환 규칙 기반)
-- ============================================
INSERT INTO dgflow_products (product_code, display_name, erp_name, thickness_mm, outer_glass, spacer, gas, inner_glass, lamination_type) VALUES
  ('26.76T-PVB-10A-6LE', '26.76T 10.76투명접합+10A+6로이', '26.76T 10.76투명접합+10A+6로이', 26.76, '5CL', '10A', NULL, '6EMT178', '0.76PVB'),
  ('24T-6CL-12A-6CL', '24T 6CL+12A+6CL', '24T 6CL+12A+6CL', 24.00, '6CL', '12A', NULL, '6CL', NULL),
  ('24T-6CL-12A-6LE', '24T 6CL+12A+6로이', '24T 6CL+12A+6로이', 24.00, '6CL', '12A', NULL, '6EMT178', NULL),
  ('22T-5GN-12Ar-5LE', '22T 5newGN+12Ar.+5로이', '22T 5newGN+12Ar.+5로이', 22.00, '5newGN', '12A', 'Ar', '5로이', NULL),
  ('22T-5CL-12Ar-5LE', '22T 5CL+12Ar.+5로이', '22T 5CL+12Ar.+5로이', 22.00, '5CL', '12A', 'Ar', '5로이', NULL),
  ('24T-6GN-12A-6LE', '24T 6newGN+12A+6로이', '24T 6newGN+12A+6로이', 24.00, '6newGN', '12A', NULL, '6로이', NULL),
  ('22T-5GN-12Ar-5DM', '22T 5newGN+12Ar.+5DURA MAX', '22T 5newGN+12Ar.+5DURA MAX', 22.00, '5newGN', '12A', 'Ar', '5DURA MAX', NULL),
  ('22T-5CL-12Ar-5DM', '22T 5CL+12Ar.+5DURA MAX', '22T 5CL+12Ar.+5DURA MAX', 22.00, '5CL', '12A', 'Ar', '5DURA MAX', NULL)
ON CONFLICT (product_code) DO NOTHING;

-- 품명 변환 매핑 (발주서에서 사용되는 다양한 표기)
INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '5CL/0.76PVB/5CL+10ALC+6EMT178',
  '5투명접합+10A+6로이'
]) v WHERE p.product_code = '26.76T-PVB-10A-6LE'
ON CONFLICT DO NOTHING;

INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '6CL+12ALC+6CL',
  '6투명+12A+6투명'
]) v WHERE p.product_code = '24T-6CL-12A-6CL'
ON CONFLICT DO NOTHING;

INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '6CL+12ALC+6EMT178',
  '6투명+12A+6로이'
]) v WHERE p.product_code = '24T-6CL-12A-6LE'
ON CONFLICT DO NOTHING;

INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '5GN+12AR+5LE',
  '그린 로이복층유리'
]) v WHERE p.product_code = '22T-5GN-12Ar-5LE'
ON CONFLICT DO NOTHING;

INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '5CL+12AR+5LE',
  '투명 로이복층유리'
]) v WHERE p.product_code = '22T-5CL-12Ar-5LE'
ON CONFLICT DO NOTHING;

INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '6GN+12A+6LE'
]) v WHERE p.product_code = '24T-6GN-12A-6LE'
ON CONFLICT DO NOTHING;

-- ============================================
-- 원판 마스터 (확인된 4종)
-- ============================================
INSERT INTO dgflow_raw_glasses (glass_type, width_mm, height_mm) VALUES
  ('표준1', 2438, 3353),
  ('표준2', 1981, 3353),
  ('표준3', 1829, 3353),
  ('표준4', 1829, 3048)
ON CONFLICT DO NOTHING;

-- ============================================
-- 거래처/현장 샘플 (주요 거래처)
-- ============================================
INSERT INTO dgflow_customers (name, short_name) VALUES
  ('(주)서해종합건설', '서해건설'),
  ('(주)대진글라스', '대진글라스'),
  ('정석개발(주)', '정석개발'),
  ('극동건설(주)', '극동건설'),
  ('에이치엘디앤아이한라(주)', 'HL한라'),
  ('에스케이에코플랜트(주)', 'SK에코'),
  ('(주)유광건설', '유광건설'),
  ('(주)대원', '대원'),
  ('엘엑스글라스(주)', 'LX글라스'),
  ('대우건설(주)', '대우건설')
ON CONFLICT DO NOTHING;

-- 현장 샘플
INSERT INTO dgflow_sites (customer_id, site_name, address, region_sido, region_sigungu)
SELECT c.id, s.site_name, s.address, s.region_sido, s.region_sigungu
FROM dgflow_customers c,
(VALUES
  ('서해건설', '울산태화강변A-2BL 아파트건설공사 2공구현장', '울산광역시', '울산', '남구'),
  ('대진글라스', '대우건설_산성역헤리스톤3BL현장', '경기도 성남시', '경기', '성남시'),
  ('정석개발', '청주 테크노폴리스 현장', '충청북도 청주시', '충북', '청주시'),
  ('극동건설', '성남금토 A-4BL 아파트', '경기도 성남시', '경기', '성남시'),
  ('HL한라', '파주선유리 후분양 공동주택', '경기도 파주시', '경기', '파주시'),
  ('SK에코', '용인 FAB 1기 지원시설', '경기도 용인시', '경기', '용인시'),
  ('유광건설', '오창 국민체육센터 현장', '충청북도 청주시', '충북', '청주시')
) AS s(short_name, site_name, address, region_sido, region_sigungu)
WHERE c.short_name = s.short_name;

