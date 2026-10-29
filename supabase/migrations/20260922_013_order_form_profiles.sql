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
