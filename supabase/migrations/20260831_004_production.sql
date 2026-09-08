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
