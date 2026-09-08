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
