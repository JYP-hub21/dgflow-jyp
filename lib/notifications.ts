import type { SupabaseClient } from '@supabase/supabase-js';
import { hasPermission, type PermissionSubject } from '@/lib/auth/role-guard';
import { unreceivedCount } from '@/lib/work-order/receipts';

/**
 * 메뉴 옆 숫자 (href → 건수) — 새로 온 일이 있다는 표시.
 * 로그인 후 공통 틀(layout)이 처음 그릴 때와, 화면을 띄워 둔 채 1분마다 다시 셀 때(/api/notifications) 같은 규칙을 쓴다.
 * 2026-11-13 회의(생산관리부): "카톡처럼 새 의뢰서가 왔을 때 작업의뢰서 옆에 숫자만 보여줘도 된다, 1을 보고 들어가면 되니까".
 */
export async function menuBadges(
  service: SupabaseClient,
  user: PermissionSubject & { id: string },
): Promise<Record<string, number>> {
  const badges: Record<string, number> = {};
  const jobs: Promise<void>[] = [];

  // 승인을 기다리는 가입 신청 — 사용자 관리
  if (hasPermission(user, 'admin:users')) {
    jobs.push((async () => {
      const { count } = await service
        .from('dgflow_users').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      if (count) badges['/admin/users'] = count;
    })());
  }
  // 나에게 온 발주서 중 아직 안 열어 본 것 — 업무지원부 '수신 발주서'
  if (hasPermission(user, 'order:process')) {
    jobs.push((async () => {
      const { count } = await service
        .from('dgflow_purchase_orders').select('id', { count: 'exact', head: true })
        .eq('assignee_id', user.id).eq('stage', 'submitted');
      if (count) badges['/purchase-orders?view=todo'] = count;
    })());
  }
  // 생산관리부가 아직 받았다고 확인하지 않은 작업의뢰서 — 생산관리부 '작업의뢰서'
  if (hasPermission(user, 'production:view')) {
    jobs.push((async () => {
      const count = await unreceivedCount(service);
      if (count) badges['/work-orders'] = count;
    })());
  }

  // 하나를 못 세도 나머지는 띄운다 — 숫자는 알림일 뿐이라 화면을 막지 않는다
  await Promise.allSettled(jobs);
  return badges;
}
