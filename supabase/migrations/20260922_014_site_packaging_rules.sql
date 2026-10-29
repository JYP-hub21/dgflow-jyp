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
