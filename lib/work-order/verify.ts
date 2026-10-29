/**
 * 옮겨 적은 작업의뢰서를 문서 자신과 대조한다.
 *
 * 작업의뢰서에는 품명 블록마다 `소계` 가, 맨 밑에 `합계` 가 인쇄돼 있다.
 * 사원이 친 품목들을 더해서 그 숫자와 맞춰 보면, 제대로 옮겼는지를
 * 다른 자료 없이 문서 하나로 확인할 수 있다. 한 행을 빠뜨리거나 수량을 잘못 치면
 * 합이 어긋나므로 바로 드러난다.
 *
 * 그래서 화면은 소계·합계를 **인쇄된 그대로** 치게 한다 —
 * 사원이 친 품목에서 계산해 채우면 항상 맞아떨어져 검산이 무의미해진다.
 */

export interface WorkOrderItemInput {
  no: number;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  /** 문서에 인쇄된 면적. 비우면 `expectedArea` 로 채운다 */
  area_m2: number;
  remark: string | null;
}

export interface WorkOrderInput {
  items: WorkOrderItemInput[];
  /** 인쇄된 소계 행 — `after_no` 는 이 소계 바로 위 품목의 No */
  printed_subtotals: { after_no: number; quantity: number; area_m2: number }[];
  /** 인쇄된 합계 행 */
  printed_total: { quantity: number; area_m2: number } | null;
}

/** 1재 = 1尺² = 303mm × 303mm. lib/erp/spec-sheet.ts 와 같은 값 */
const SAI_M2 = 0.303 * 0.303;

/**
 * 장당 최소 면적 = 3재. 작은 유리에 걸리는 최소 과금 단위다.
 *
 * 서해 26-2286 에서 실면적 0.17~0.23 인 7개 행이 예외 없이 0.28 로 찍혔고
 * (3재 = 0.275427 → 반올림 0.28), 우미 26-1952 는 가장 작은 행이 0.29 라 걸리지 않았다.
 * **문서 두 장에서 뽑아낸 값이라 확정은 아니다.** 그래서 행별 면적 대조는 경고로만 쓰고
 * 저장을 막지 않는다 — 막는 것은 소계·합계뿐이다.
 */
const MIN_AREA_M2 = round2(3 * SAI_M2);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sum(ns: number[]): number {
  return round2(ns.reduce((a, b) => a + b, 0));
}

/** 2자리까지 맞으면 같다고 본다 */
function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

export interface Tally {
  quantity: number;
  area_m2: number;
}

export interface BlockCheck {
  /** 이 블록 품목들의 품명 (상속 후) */
  product_name: string;
  from_no: number;
  to_no: number;
  counted: Tally;
  printed: Tally;
  quantity_ok: boolean;
  area_ok: boolean;
}

export interface RowWarning {
  no: number;
  printed_area: number;
  expected_area: number;
}

export interface ScanCheck {
  /** 소계·합계가 전부 맞는가 */
  ok: boolean;
  blocks: BlockCheck[];
  total: {
    counted: Tally;
    printed: Tally;
    quantity_ok: boolean;
    area_ok: boolean;
  } | null;
  /** 규격과 면적이 서로 안 맞는 행 — 경고일 뿐 저장을 막지 않는다 */
  row_warnings: RowWarning[];
  /** 문서에 합계가 아예 없어 대조하지 못한 경우 */
  no_printed_total: boolean;
}

function tally(items: WorkOrderItemInput[]): Tally {
  return {
    quantity: items.reduce((s, i) => s + i.quantity, 0),
    area_m2: sum(items.map((i) => i.area_m2)),
  };
}

/** 규격으로부터 기대되는 면적 — 장당 2자리 반올림 후 최소 3재, 그다음 수량 곱 */
export function expectedArea(
  width_mm: number,
  height_mm: number,
  quantity: number
): number {
  const per = Math.max(round2((width_mm * height_mm) / 1_000_000), MIN_AREA_M2);
  return round2(per * quantity);
}

export function verifyScan(scan: WorkOrderInput): ScanCheck {
  const blocks: BlockCheck[] = [];

  // 소계는 품명 블록의 경계다. `after_no` 까지를 한 블록으로 끊는다.
  const bounds = [...scan.printed_subtotals].sort((a, b) => a.after_no - b.after_no);
  let cursor = 0;
  for (const bound of bounds) {
    const items = scan.items.filter(
      (i) => i.no > cursor && i.no <= bound.after_no
    );
    cursor = bound.after_no;
    if (items.length === 0) continue;

    const counted = tally(items);
    blocks.push({
      product_name: items[0].product_name,
      from_no: items[0].no,
      to_no: items[items.length - 1].no,
      counted,
      printed: { quantity: bound.quantity, area_m2: bound.area_m2 },
      quantity_ok: counted.quantity === bound.quantity,
      area_ok: same(counted.area_m2, bound.area_m2),
    });
  }

  const countedAll = tally(scan.items);
  const total = scan.printed_total
    ? {
        counted: countedAll,
        printed: scan.printed_total,
        quantity_ok: countedAll.quantity === scan.printed_total.quantity,
        area_ok: same(countedAll.area_m2, scan.printed_total.area_m2),
      }
    : null;

  const row_warnings: RowWarning[] = [];
  for (const item of scan.items) {
    const expected = expectedArea(item.width_mm, item.height_mm, item.quantity);
    if (!same(expected, item.area_m2)) {
      row_warnings.push({
        no: item.no,
        printed_area: item.area_m2,
        expected_area: expected,
      });
    }
  }

  const ok =
    blocks.every((b) => b.quantity_ok && b.area_ok) &&
    (total === null || (total.quantity_ok && total.area_ok));

  return {
    ok,
    blocks,
    total,
    row_warnings,
    no_printed_total: scan.printed_total === null,
  };
}
