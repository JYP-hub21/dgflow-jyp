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
