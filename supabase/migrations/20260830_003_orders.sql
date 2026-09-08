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
