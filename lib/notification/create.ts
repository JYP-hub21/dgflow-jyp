import { createServiceRoleClient } from '@/lib/supabase/server';
import type { OrderStatus } from '@/types/order-status';

// 상태 변경 시 누구에게 알림을 보낼지 결정
const NOTIFICATION_TARGETS: Partial<Record<OrderStatus, { roles: string[]; toCreator?: boolean; message: string }>> = {
  pending_customer: { roles: [], toCreator: false, message: '고객에게 승인 요청이 전송되었습니다' },
  customer_approved: { roles: ['biz_support'], toCreator: true, message: '고객이 주문을 승인했습니다' },
  rejected_by_customer: { roles: [], toCreator: true, message: '고객이 주문을 반려했습니다' },
  under_review: { roles: [], toCreator: true, message: '경영지원팀이 검토를 시작했습니다' },
  review_completed: { roles: ['admin'], toCreator: false, message: '검토가 완료되어 승인 대기 중입니다' },
  final_approved: { roles: ['biz_support'], toCreator: true, message: '주문이 최종 승인되었습니다' },
  rejected_by_admin: { roles: ['biz_support'], toCreator: true, message: '주문이 반려되었습니다' },
  erp_completed: { roles: [], toCreator: true, message: 'ERP 입력이 완료되었습니다' },
  work_order_created: { roles: ['production_mgr'], toCreator: true, message: '작업의뢰서가 생성되었습니다' },
};

export async function createNotifications(
  orderId: string,
  newStatus: OrderStatus,
  createdBy?: string,
) {
  const config = NOTIFICATION_TARGETS[newStatus];
  if (!config) return;

  const supabase = createServiceRoleClient();
  const notifications: { user_id: string; type: string; message: string; order_id: string }[] = [];

  // 역할별 알림
  if (config.roles.length > 0) {
    const { data: users } = await supabase
      .from('dgflow_users')
      .select('id, role')
      .in('role', config.roles)
      .eq('is_active', true);

    (users || []).forEach(u => {
      notifications.push({
        user_id: u.id,
        type: newStatus,
        message: config.message,
        order_id: orderId,
      });
    });
  }

  // 주문 작성자에게 알림
  if (config.toCreator && createdBy) {
    if (!notifications.some(n => n.user_id === createdBy)) {
      notifications.push({
        user_id: createdBy,
        type: newStatus,
        message: config.message,
        order_id: orderId,
      });
    }
  }

  if (notifications.length > 0) {
    await supabase.from('dgflow_notifications').insert(notifications);
  }
}
