import PermissionGate from '@/components/layout/PermissionGate';
import PageHeader from '@/components/layout/PageHeader';
import PurchaseOrderForm from '@/components/purchase-order/PurchaseOrderForm';
import { getCurrentUser } from '@/lib/auth/get-user';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { listAssignees } from '@/lib/purchase-order/server';

export default function Page() {
  return (
    <PermissionGate permission="order:submit">
      <NewPurchaseOrderPage />
    </PermissionGate>
  );
}

async function NewPurchaseOrderPage() {
  const user = (await getCurrentUser())!;
  const supabase = createServiceRoleClient();
  const [assignees, { data: customers }, { data: sites }] = await Promise.all([
    listAssignees(supabase),
    supabase.from('dgflow_customers').select('name').order('name'),
    supabase.from('dgflow_sites').select('site_name').order('site_name'),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="발주서 등록"
        back={{ href: '/purchase-orders', label: '발주서' }}
        description="메일 대신 이곳에 업로드하고 담당자를 지목하세요. 담당자가 열람하면 확인 시각이 기록됩니다."
      />
      <PurchaseOrderForm
        meId={user.id}
        assignees={assignees}
        customers={(customers ?? []).map(c => c.name)}
        sites={(sites ?? []).map(s => s.site_name)}
      />
    </div>
  );
}
