import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/get-user';
import { loginIdLocked } from '@/lib/auth/quick-login';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { menuBadges } from '@/lib/notifications';
import Sidebar from '@/components/layout/Sidebar';
import { CurrentUserProvider } from '@/components/layout/CurrentUser';
import FileDropGuard from '@/components/layout/FileDropGuard';
import PrismAssistant from '@/components/prism/PrismAssistant';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  // 메뉴 옆 숫자 — 가입 신청 · 나에게 온 발주서 · 수신 확인 전 작업의뢰서 (2026-11-06 · 11-13 회의 "카톡처럼").
  // 화면을 띄워 둔 동안은 사이드바가 1분마다 /api/notifications 로 다시 센다.
  const badges = await menuBadges(createServiceRoleClient(), user);

  return (
    // 인쇄할 때는 메뉴를 빼고, 화면 높이에 갇힌 스크롤을 풀어 내용 전체가 찍히게 한다 (2026-11-10 점검: 1장에서 잘렸다)
    <div className="flex h-screen supports-[height:100dvh]:h-[100dvh] print:block print:h-auto">
      <Sidebar
        userName={user.name}
        user={{ role: user.role, permissions: user.permissions, department: user.department }}
        department={user.department}
        position={user.position}
        badges={badges}
        loginId={user.login_id}
        loginIdLocked={loginIdLocked(user.login_id)}
      />
      {/* 폰에서는 상단 띠(h-14)가 고정이라 그만큼 내려서 시작한다 */}
      <main id="app-main" className="min-w-0 flex-1 overflow-y-auto bg-background p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-18 md:p-6 md:pb-6 md:pt-6 lg:p-8 lg:pb-8 print:overflow-visible print:bg-white print:p-0">
        <CurrentUserProvider user={{
          id: user.id, name: user.name, role: user.role, permissions: user.permissions, department: user.department,
        }}>
          {children}
          {/* DG 프리즘 대화창 — 왼쪽 메뉴의 'DG 프리즘에게 묻기' 로 연다 */}
          <PrismAssistant />
        </CurrentUserProvider>
        <FileDropGuard />
      </main>
    </div>
  );
}
