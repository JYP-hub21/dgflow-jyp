import { createServiceRoleClient } from '@/lib/supabase/server';
import type { OrderStatus } from '@/types/order-status';

// 상태 변경 시 누구에게 알림을 보낼지 결정
const NOTIFICATION_TARGETS: Partial<Record<OrderStatus, { roles: string[]; toCreator?: boolean; template: string }>> = {
  pending_customer: { roles: [], toCreator: false, template: '{{customer}} {{site}} 주문에 고객 승인 요청이 전송되었습니다' },
  customer_approved: { roles: ['biz_support'], toCreator: true, template: '{{customer}} {{site}} 주문을 고객이 승인했습니다' },
  rejected_by_customer: { roles: [], toCreator: true, template: '{{customer}} {{site}} 주문을 고객이 반려했습니다' },
  under_review: { roles: [], toCreator: true, template: '{{customer}} {{site}} 주문을 경영지원팀이 검토 중입니다' },
  review_completed: { roles: ['admin'], toCreator: false, template: '{{customer}} {{site}} 주문 검토 완료 — 승인 대기 중' },
  final_approved: { roles: ['biz_support'], toCreator: true, template: '{{customer}} {{site}} 주문이 최종 승인되었습니다' },
  rejected_by_admin: { roles: ['biz_support'], toCreator: true, template: '{{customer}} {{site}} 주문이 반려되었습니다' },
  erp_completed: { roles: [], toCreator: true, template: '{{customer}} {{site}} ERP 입력이 완료되었습니다' },
  work_order_created: { roles: ['production_mgr'], toCreator: true, template: '{{customer}} {{site}} 작업의뢰서가 생성되었습니다' },
};

function truncate(str: string, max: number): string {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '...' : str;
}

export async function createNotifications(
  orderId: string,
  newStatus: OrderStatus,
  createdBy?: string,
) {
  const config = NOTIFICATION_TARGETS[newStatus];
  if (!config) return;

  const supabase = createServiceRoleClient();

  // 주문 정보 조회 (거래처/현장명)
  const { data: order } = await supabase
    .from('dgflow_orders')
    .select('order_number, customer:dgflow_customers(short_name), site:dgflow_sites(site_name)')
    .eq('id', orderId)
    .single();

  const customerObj = order?.customer as unknown as { short_name: string } | null;
  const siteObj = order?.site as unknown as { site_name: string } | null;
  const customer = truncate(customerObj?.short_name || '', 10);
  const site = truncate(siteObj?.site_name || '', 15);

  const message = config.template
    .replace('{{customer}}', customer ? `[${customer}]` : '')
    .replace('{{site}}', site)
    .replace(/\s+/g, ' ')
    .trim();

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
        message,
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
        message,
        order_id: orderId,
      });
    }
  }

  if (notifications.length > 0) {
    await supabase.from('dgflow_notifications').insert(notifications);
  }
}
