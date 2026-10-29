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
