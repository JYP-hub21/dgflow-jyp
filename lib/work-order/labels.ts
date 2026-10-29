/**
 * 작업의뢰서의 거래처 · 현장 이름을 고른다.
 *
 * 작업의뢰서는 두 길로 들어온다 —
 *  ① 우리 주문에서 생성 (최종승인 · 발주서 직행) → `dgflow_orders` 에 거래처·현장이 걸려 있다
 *  ② ERP 가 뽑은 것을 등록 (`/work-orders/receive`) → 주문이 없고 작업의뢰서 자신이 이름을 들고 있다
 *
 * ②를 받으려고 마이그레이션 015 에서 `order_id` 를 풀었으므로 `order` 는 null 일 수 있다.
 * 화면마다 따로 분기하지 말고 여기 한 곳에서 고른다.
 */

export interface WorkOrderLabelSource {
  customer_label?: string | null;
  site_label?: string | null;
  order?: {
    customer?: { short_name?: string | null; name?: string | null } | null;
    site?: { site_name?: string | null } | null;
  } | null;
}

function pick(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    const t = v?.trim();
    if (t) return t;
  }
  return null;
}

export function workOrderLabels(wo: WorkOrderLabelSource): {
  customer: string | null;
  site: string | null;
  /** 머리글 한 줄 — 둘 다 없으면 null 이라 줄 자체를 비울 수 있다 */
  heading: string | null;
} {
  const customer = pick(
    wo.order?.customer?.short_name,
    wo.order?.customer?.name,
    wo.customer_label
  );
  const site = pick(wo.order?.site?.site_name, wo.site_label);

  return {
    customer,
    site,
    heading: [customer, site].filter(Boolean).join(' / ') || null,
  };
}
