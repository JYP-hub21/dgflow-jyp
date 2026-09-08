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
