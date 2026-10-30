import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import Sidebar from '@/components/layout/Sidebar';
import { CurrentUserProvider } from '@/components/layout/CurrentUser';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  // 승인을 기다리는 가입 신청 — 사용자 관리 메뉴 옆에 숫자로 띄운다
  const badges: Record<string, number> = {};
  if (hasPermission(user, 'admin:users')) {
    const { count } = await createServiceRoleClient()
      .from('dgflow_users').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    if (count) badges['/admin/users'] = count;
  }
  // 나에게 온 발주서 중 아직 안 열어 본 것 — 업무지원부 구역의 '받은 발주서' 옆에 띄운다
  if (hasPermission(user, 'order:process')) {
    const { count } = await createServiceRoleClient()
      .from('dgflow_purchase_orders').select('id', { count: 'exact', head: true })
      .eq('assignee_id', user.id).eq('stage', 'submitted');
    if (count) badges['/purchase-orders?view=todo'] = count;
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        userName={user.name}
        user={{ role: user.role, permissions: user.permissions }}
        department={user.department}
        badges={badges}
      />
      {/* 폰에서는 상단 띠(h-14)가 고정이라 그만큼 내려서 시작한다 */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-background p-4 pt-18 md:p-6 md:pt-6 lg:p-8">
        <CurrentUserProvider user={{
          id: user.id, name: user.name, role: user.role, permissions: user.permissions, department: user.department,
        }}>
          {children}
        </CurrentUserProvider>
      </main>
    </div>
  );
}
