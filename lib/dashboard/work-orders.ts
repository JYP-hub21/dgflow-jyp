import { kstDateOf } from '@/lib/kst-date';

/**
 * 대시보드 계산 — 화면 밖에서 시험할 수 있게 따로 둔다 (2026-11-10 점검).
 *
 * 작업의뢰서는 **전량 납품해야** status 가 completed 가 된다(2026-11-09 납품 기능). 그래서 status 만으로
 * '진행 중' 을 고르면 다 만들고 아직 안 나간 의뢰서가 100% 로 쌓여 '납기 가까운 순' 8칸을 채웠다.
 * 대시보드의 '생산이 남은 작업의뢰서' 는 **품목마다** 의뢰 수량보다 덜 만든 것이 있는 의뢰서다.
 */

export interface ItemQty {
  work_order_id: string;
  quantity: number | null;
  produced_quantity: number | null;
}

export interface WorkOrderProgress {
  /** 의뢰 수량 합 */
  total: number;
  /** 만든 수량 합 — 품목마다 의뢰 수량까지만 센다(한 품목을 더 만들어도 다른 품목의 모자람을 가리지 않게) */
  done: number;
  /** 품목마다 덜 만든 수량의 합 */
  remaining: number;
  /** 내림 — 덜 만든 것이 있으면 100% 로 보이지 않는다 */
  percent: number;
  /** 품목이 있고 모든 품목을 의뢰 수량만큼 만들었다 (납품만 남음) */
  produced_all: boolean;
}

export const NO_PROGRESS: WorkOrderProgress = { total: 0, done: 0, remaining: 0, percent: 0, produced_all: false };

export function progressByWorkOrder(items: ItemQty[]): Map<string, WorkOrderProgress> {
  const map = new Map<string, WorkOrderProgress>();
  for (const it of items) {
    const q = Math.max(0, it.quantity ?? 0);
    const p = Math.max(0, it.produced_quantity ?? 0);
    const cur = map.get(it.work_order_id) ?? { ...NO_PROGRESS };
    cur.total += q;
    cur.done += Math.min(p, q);
    cur.remaining += Math.max(q - p, 0);
    map.set(it.work_order_id, cur);
  }
  for (const v of map.values()) {
    v.percent = v.total > 0 ? Math.floor(v.done / v.total * 100) : 0;
    v.produced_all = v.total > 0 && v.remaining === 0;
  }
  return map;
}

/**
 * 완료된 발주 건이 이번 달(monthStart 'YYYY-MM-01' 이후)에 완료됐나.
 *
 * 발주 건의 '완료' 는 저장된 값이 아니라 계산값이라 완료 시각 칸이 없다(이력 표에도 '완료' 기록은 없다).
 * 완료가 되는 때는 ① 마지막 생산 기록이 들어갈 때 ② 이미 다 만든 의뢰서를 이을 때 중 늦은 쪽이므로
 * 이 달에 이어진 의뢰서의 생산 기록이 있거나, 이 달에 의뢰서를 이었으면 이 달 완료로 친다.
 * 예전에는 접수일(created_at)로 셌다 — 지난달 접수해 이번 달 끝난 건이 빠지고, 이번 달 접수 건만 셌다.
 * 생산 기록 없이 수량만 채운 의뢰서(지난 의뢰서 가져오기)나 수량을 줄여 끝난 의뢰서는 날짜를 알 수 없어 세지 않는다.
 */
export function doneInMonth(
  po: { work_order_ids: string[]; last_linked_at: string | null },
  monthStart: string,
  producedThisMonth: Set<string>,
): boolean {
  if (po.work_order_ids.some(id => producedThisMonth.has(id))) return true;
  const linked = kstDateOf(po.last_linked_at);
  return linked != null && linked >= monthStart;
}
