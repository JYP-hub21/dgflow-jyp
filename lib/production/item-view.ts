/**
 * 생산 화면에서 품목을 보여 줄 때 쓰는 계산 — 2026-10-30 생산부서 피드백 (회의 녹음 · 워드 8번).
 *
 *  · No. — 종이 작업의뢰서의 품목 번호. 현장에서 "2090 에 7번" 처럼 번호로 말한다.
 *    다 만든 품목을 접거나 남은 것만 보여도 번호는 그대로라 종이와 맞춰 볼 수 있다 (워드 3번 "미완료가 위로 올라가 번호가 안 맞는다").
 *  · 품명 덩어리별 소계 — 작업의뢰서는 같은 품명이 이어지는 덩어리로 되어 있다.
 *  · 생산 날짜 — 여러 날에 나눠 만든 품목은 날짜별 수량을, 덜 만든 품목은 마지막으로 만든 날을.
 *    잘못 넣었을 때 "그날 박스" 를 찾으려면 날짜가 필요하다.
 */

/** 작업의뢰서 품목 번호 (sort_order 는 0부터) */
export function itemNo(item: { sort_order?: number | null }, fallbackIndex = 0): number {
  return (item.sort_order ?? fallbackIndex) + 1;
}

export interface BlockTotal {
  product_name: string;
  /** 덩어리의 마지막 품목 위치 (이 뒤에 소계 줄을 그린다) */
  endIndex: number;
  count: number;
  quantity: number;
  produced: number;
}

/** 이어지는 같은 품명끼리 묶은 소계 (순서는 받은 그대로) */
export function blockTotals(items: { product_name: string; quantity: number; produced_quantity: number }[]): BlockTotal[] {
  const blocks: BlockTotal[] = [];
  items.forEach((it, i) => {
    const last = blocks[blocks.length - 1];
    if (last && last.product_name === it.product_name && last.endIndex === i - 1) {
      last.endIndex = i;
      last.count++;
      last.quantity += it.quantity;
      last.produced += it.produced_quantity;
    } else {
      blocks.push({ product_name: it.product_name, endIndex: i, count: 1, quantity: it.quantity, produced: it.produced_quantity });
    }
  });
  return blocks;
}

export interface DayQty { date: string; quantity: number }

/** 품목별 생산 날짜와 그날 수량 (날짜순) */
export function productionDaysByItem(
  logs: { work_order_item_id: string | null; production_date: string; quantity_completed: number }[],
): Map<string, DayQty[]> {
  const map = new Map<string, Map<string, number>>();
  for (const l of logs) {
    if (!l.work_order_item_id) continue;
    const days = map.get(l.work_order_item_id) ?? new Map<string, number>();
    days.set(l.production_date, (days.get(l.production_date) ?? 0) + l.quantity_completed);
    map.set(l.work_order_item_id, days);
  }
  return new Map([...map.entries()].map(([id, days]) => [
    id, [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, quantity]) => ({ date, quantity })),
  ]));
}

/** "10/1 25 · 10/9 1 · 10/12 1" — 많으면 앞의 몇 날과 "외 n일" */
export function formatDays(days: DayQty[], max = 3): string {
  const short = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
  const shown = days.length > max ? days.slice(-max) : days;
  const text = shown.map(d => `${short(d.date)} ${d.quantity}`).join(' · ');
  return days.length > max ? `외 ${days.length - max}일 · ${text}` : text;
}

/** 두 날짜 사이 날 수 (b 가 늦으면 양수) */
export function daysBetweenDates(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}
