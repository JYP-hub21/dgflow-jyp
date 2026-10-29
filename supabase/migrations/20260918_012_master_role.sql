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
