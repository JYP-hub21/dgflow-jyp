/**
 * ERP 업로드 엑셀의 포장 ↔ ERP 가 뽑아 준 작업의뢰서 대조.
 *
 * ERP 에 손으로 옮기다 틀린 수량 · 규격이 있으면 유리를 자르기 전에 잡는다.
 * 그리고 같은 계산으로 "이 작업의뢰서가 어느 포장에서 나왔나" 를 찾는다
 * (ERP 작업의뢰서에는 우리 접수번호를 적을 칸이 없어 내용으로만 짝을 찾는다).
 *
 * 비교는 **규격(가로×세로)별 수량 합** 으로 한다.
 *  - 위치 문구는 ERP 가 다시 쓰거나 합친다 — 비교하면 멀쩡한 짝도 틀렸다고 나온다.
 *  - ERP 업로드 엑셀에는 품명 열이 없다. 복층유리 작업의뢰서는 같은 규격 목록이
 *    品名 블록마다(外/內) 되풀이되기도 한다(우미 26-1952 의 1~6행과 7~12행).
 *    그래서 모든 규격이 똑같이 k 배면 "k 블록" 으로 보고 일치로 친다.
 */

export interface SizeQty {
  width_mm: number;
  height_mm: number;
  quantity: number;
}

export interface SizeDiff {
  width_mm: number;
  height_mm: number;
  /** ERP 엑셀(포장) 쪽 수량 × 배수 */
  expected: number;
  /** 작업의뢰서 쪽 수량 */
  actual: number;
}

export interface CheckResult {
  ok: boolean;
  /** 작업의뢰서가 포장의 몇 배인가 (품명 블록 수). 맞는 배수가 없으면 1 */
  multiple: number;
  package_total: number;
  work_order_total: number;
  /** 규격별로 다른 곳 — 많아도 20개까지만 */
  diffs: SizeDiff[];
  /** 0~1. 짝 찾기 순위에 쓴다 */
  score: number;
}

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

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export function compareSizes(packageRows: SizeQty[], workOrderItems: SizeQty[]): CheckResult {
  const a = tally(packageRows);
  const b = tally(workOrderItems);
  const aTotal = sum(a);
  const bTotal = sum(b);

  // 모든 규격이 같은 배수로 늘어났으면 그 배수로 맞춰 본다
  let multiple = 1;
  if (aTotal > 0 && bTotal > aTotal && bTotal % aTotal === 0) {
    const k = bTotal / aTotal;
    const sameKeys = a.size === b.size && [...a.keys()].every(s => b.has(s));
    if (sameKeys && [...a].every(([s, q]) => b.get(s) === q * k)) multiple = k;
  }

  const diffs: SizeDiff[] = [];
  let overlap = 0;
  for (const s of new Set([...a.keys(), ...b.keys()])) {
    const expected = (a.get(s) ?? 0) * multiple;
    const actual = b.get(s) ?? 0;
    overlap += Math.min(expected, actual);
    if (expected !== actual) {
      const [w, h] = s.split('x').map(Number);
      diffs.push({ width_mm: w, height_mm: h, expected, actual });
    }
  }
  diffs.sort((x, y) => x.width_mm - y.width_mm || x.height_mm - y.height_mm);

  const denom = Math.max(aTotal * multiple, bTotal);
  return {
    ok: diffs.length === 0 && aTotal > 0,
    multiple,
    package_total: aTotal,
    work_order_total: bTotal,
    diffs: diffs.slice(0, 20),
    score: denom > 0 ? overlap / denom : 0,
  };
}

/** 짝 후보로 보여 줄 만큼 닮았나 — 규격 수량의 절반 이상이 겹쳐야 */
export const SUGGEST_MIN_SCORE = 0.5;

/** 대조 결과 한 줄 요약 */
export function checkSummary(r: CheckResult): string {
  if (r.ok) return r.multiple > 1 ? `규격 · 수량 일치 (품명 블록 ${r.multiple}개)` : '규격 · 수량 일치';
  return `규격 ${r.diffs.length}가지 다름 — ERP 엑셀 ${r.package_total * r.multiple}장 / 작업의뢰서 ${r.work_order_total}장`;
}
