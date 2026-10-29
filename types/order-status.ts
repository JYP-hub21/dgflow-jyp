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
/**
 * 상태 배지 색.
 * 14단계를 의미 단위로 묶어 색 수를 줄였다 —
 * 회색=작성 전, 네이비=진행, 앰버=대기, 적색=반려, 녹색=승인/완료, 청록=생산.
 */
export const STATUS_COLORS: Record<OrderStatus, string> = {
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  completed: 'bg-slate-100 text-slate-700 border-slate-300',

  pending_customer: 'bg-amber-50 text-amber-700 border-amber-200',
  pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',

  rejected_by_customer: 'bg-red-50 text-red-700 border-red-200',
  rejected_by_admin: 'bg-red-50 text-red-700 border-red-200',

  customer_approved: 'bg-brand-50 text-brand-800 border-brand-100',
  under_review: 'bg-brand-50 text-brand-800 border-brand-100',
  review_completed: 'bg-brand-100 text-brand-900 border-brand-100',

  final_approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  erp_completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',

  work_order_created: 'bg-teal-50 text-teal-700 border-teal-200',
  in_production: 'bg-teal-50 text-teal-700 border-teal-200',
  production_completed: 'bg-emerald-600 text-white border-emerald-600',
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
