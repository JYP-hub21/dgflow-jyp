import ErpUploadBuilder, { type PurchaseOrderSource } from '@/components/erp/ErpUploadBuilder';
import PageHeader from '@/components/layout/PageHeader';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * ?po={발주 건 id} 로 열면 그 건의 발주서를 바로 읽고, 결과를 그 건에 저장한다.
 * 그냥 열면 예전처럼 파일을 골라 다운로드만 한다.
 */
export default async function ErpUploadPage({ searchParams }: { searchParams: Promise<{ po?: string }> }) {
  const { po } = await searchParams;
  const user = (await getCurrentUser())!;

  let purchaseOrder: PurchaseOrderSource | undefined;
  if (po && hasPermission(user, 'order:process')) {
    const supabase = createServiceRoleClient();
    const [{ data: row }, { data: files }] = await Promise.all([
      supabase.from('dgflow_purchase_orders').select('id, intake_number, site_name, customer_name').eq('id', po).maybeSingle(),
      supabase.from('dgflow_purchase_order_files')
        .select('id, file_name, mime_type, size_bytes, storage_prefix, chunk_count')
        .eq('purchase_order_id', po).eq('kind', 'order').is('purged_at', null).order('created_at'),
    ]);
    if (row) {
      purchaseOrder = {
        id: row.id,
        intake_number: row.intake_number,
        label: [row.customer_name, row.site_name].filter(Boolean).join(' ') || '현장 미기재',
        files: files ?? [],
      };
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="ERP 업로드 엑셀 만들기"
        back={purchaseOrder ? { href: `/purchase-orders/${purchaseOrder.id}`, label: `발주 ${purchaseOrder.intake_number}` } : undefined}
        description="발주서를 올리면 포장 단위마다 시트 한 장씩, ERP에 넣을 위치 · 가로 · 세로 · 수량 양식으로 만들어 줍니다. 자동으로 확정할 수 없는 값은 비워 두고 따로 표시합니다."
      />

      <ErpUploadBuilder purchaseOrder={purchaseOrder} />
    </div>
  );
}
