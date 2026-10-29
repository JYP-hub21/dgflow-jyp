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
