export const ORDER_STATUS = {
  draft: '작성중',
  completed: '작성완료',
  pending_customer: '고객승인대기',
  rejected_by_customer: '반려-수정중',
  customer_approved: '고객승인완료',
  under_review: '검토중',
  review_completed: '검토완료',
  pending_approval: '승인대기',
  rejected_by_admin: '반려-재검토',
  final_approved: '최종승인',
  erp_completed: 'ERP입력완료',
  work_order_created: '작업의뢰서생성',
  in_production: '생산중',
  production_completed: '생산완료',
} as const;

export type OrderStatus = keyof typeof ORDER_STATUS;

// 상태별 색상 (뱃지용)
export const STATUS_COLORS: Record<OrderStatus, string> = {
  draft: 'bg-gray-100 text-gray-800',
  completed: 'bg-blue-50 text-blue-800',
  pending_customer: 'bg-yellow-100 text-yellow-800',
  rejected_by_customer: 'bg-red-100 text-red-800',
  customer_approved: 'bg-blue-100 text-blue-800',
  under_review: 'bg-purple-100 text-purple-800',
  review_completed: 'bg-indigo-100 text-indigo-800',
  pending_approval: 'bg-orange-100 text-orange-800',
  rejected_by_admin: 'bg-red-100 text-red-800',
  final_approved: 'bg-green-100 text-green-800',
  erp_completed: 'bg-emerald-100 text-emerald-800',
  work_order_created: 'bg-teal-100 text-teal-800',
  in_production: 'bg-cyan-100 text-cyan-800',
  production_completed: 'bg-green-200 text-green-900',
};

// 수정/삭제 가능한 상태
export const EDITABLE_STATUSES: OrderStatus[] = ['draft', 'completed', 'rejected_by_customer', 'rejected_by_admin'];

// ERP 엑셀 다운로드 가능한 상태
export const ERP_DOWNLOADABLE_STATUSES: OrderStatus[] = ['final_approved', 'erp_completed', 'work_order_created', 'in_production', 'production_completed'];

// 허용된 상태 전이
export const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['completed'],
  completed: ['pending_customer', 'draft'],
  pending_customer: ['customer_approved', 'rejected_by_customer', 'completed'],
  rejected_by_customer: ['completed'],
  customer_approved: ['under_review'],
  under_review: ['review_completed'],
  review_completed: ['pending_approval', 'final_approved', 'rejected_by_admin'],
  pending_approval: ['final_approved', 'rejected_by_admin'],
  rejected_by_admin: ['under_review'],
  final_approved: ['work_order_created', 'review_completed'],
  erp_completed: ['work_order_created'],
  work_order_created: ['in_production'],
  in_production: ['production_completed'],
  production_completed: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
