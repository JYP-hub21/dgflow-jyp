import type { SizeQty } from '@/lib/purchase-order/match';

/**
 * 규격이 딱 맞는 포장이 없을 때 "가장 가까운" ERP 포장을 고른다 (2026-11-10 점검).
 *
 * 예전에는 딱 맞는 포장이 없으면 '직접 연결' 포장을 새로 만들어 대조 없이 붙였다 — 오타 하나 있는 작업의뢰서가
 * '대조 없이' 붙고, 진짜 포장은 '작업의뢰서 기다리는 중' 에 영영 남고, 오타는 어디에도 안 보였다.
 * 이제 가장 가까운 포장에 붙이고 대조 결과를 저장해 'ERP 엑셀과 다름' 이 빨갛게 보이게 한다.
 *
 * 가까움은 순서대로 —
 *  ① 수량까지 같은 규격(가로 × 세로)이 많은 것. 복층은 같은 규격이 품명 블록마다 되풀이되므로
 *     작업의뢰서 합 ÷ 포장 합을 반올림한 배수 k 로도 맞춰 보고 더 많이 맞는 쪽을 쓴다
 *  ② 합계 수량 차이(포장 합 × k 와 작업의뢰서 합)가 작은 것
 *  ③ 그래도 같으면 먼저 온 것(호출하는 쪽이 포장 순서 seq 로 넘긴다)
 * 단 규격이 하나도 겹치지 않으면(수량 무시) 어느 포장의 것도 아니라고 보고 null — 예전처럼 '직접 연결' 로 간다.
 * 안 그러면 엉뚱한 포장에 빨간 '다름' 으로 붙고, 그 포장의 진짜 작업의뢰서가 나중에 갈 곳을 잃는다.
 */

const key = (w: number, h: number) => `${w}x${h}`;

function tally(rows: SizeQty[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const w = Math.round(Number(r.width_mm));
    const h = Math.round(Number(r.height_mm));
    const q = Math.round(Number(r.quantity));
    if (!w || !h || !q) continue;
    m.set(key(w, h), (m.get(key(w, h)) ?? 0) + q);
  }
  return m;
}

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export interface Closeness {
  /** 수량까지 같은 규격 가짓수 */
  lines: number;
  /** 합계 수량 차이 */
  gap: number;
  /** 수량은 달라도 양쪽에 다 있는 규격 가짓수 */
  shared: number;
}

export function closeness(packageRows: SizeQty[], workOrderItems: SizeQty[]): Closeness {
  const a = tally(packageRows);
  const b = tally(workOrderItems);
  const aTotal = total(a);
  const bTotal = total(b);
  const ks = new Set([1]);
  if (aTotal > 0) ks.add(Math.max(1, Math.round(bTotal / aTotal)));

  let shared = 0;
  for (const s of a.keys()) if (b.has(s)) shared++;
  let best: Closeness = { lines: -1, gap: Infinity, shared };
  for (const k of ks) {
    let lines = 0;
    for (const [s, q] of a) if (b.get(s) === q * k) lines++;
    const gap = Math.abs(aTotal * k - bTotal);
    if (lines > best.lines || (lines === best.lines && gap < best.gap)) best = { lines, gap, shared };
  }
  return best;
}

/** 가장 가까운 포장. 포장이 없거나, 규격이 하나도 겹치는 포장이 없으면 null */
export function closestPackage<P extends { rows: SizeQty[] | null }>(packages: P[], workOrderItems: SizeQty[]): P | null {
  let best: { p: P; c: Closeness } | null = null;
  for (const p of packages) {
    const c = closeness(p.rows ?? [], workOrderItems);
    if (c.shared === 0) continue;
    if (!best || c.lines > best.c.lines || (c.lines === best.c.lines && c.gap < best.c.gap)) best = { p, c };
  }
  return best?.p ?? null;
}
