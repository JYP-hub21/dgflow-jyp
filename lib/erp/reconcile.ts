/**
 * 검산 — 발주서가 스스로 적어 둔 수량과 우리 계산을 대조한다.
 *
 * 발주서에는 이미 정답이 적혀 있다. 블록 끝의 `계`, 포장 끝의 회색 `합계`, 맨 아래 `총계`.
 * 우리 출력과 이 숫자를 맞춰 보면, 파서가 완벽하지 않아도 **틀렸다는 사실 자체는**
 * 사원이 즉시 알 수 있다. 숫자가 다 맞으면 믿고 넘어가고, 틀리면 어디서 틀렸는지 보인다.
 *
 * 이게 이 시스템에서 가장 값싸고 효과가 큰 안전장치다 —
 * "모든 발주서 양식을 완벽히 이해한다" 는 불가능하지만,
 * "이 발주서를 제대로 읽었는지" 는 발주서 자신에게 물어볼 수 있다.
 *
 * 발주서의 합계 수식이 깨져 있는 경우도 있다 (실물에서 총계가 `118.33` 으로 들어 있었다).
 * 그런 값은 스캔 단계에서 기준으로 채택하지 않으므로 여기서는 `기준 없음` 으로 나온다.
 */
import type { OrderScan } from '@/lib/parser/order-scan';

export type ReconcileScope = 'block' | 'package' | 'total' | 'output';

export interface ReconcileLine {
  scope: ReconcileScope;
  label: string;
  /** 발주서에 적힌 수량. 없거나 못 믿을 값이면 null */
  declared: number | null;
  /** 우리가 읽은 수량 */
  actual: number;
  /** true 일치 · false 불일치 · null 대조할 기준이 없음 */
  ok: boolean | null;
}

export interface Reconciliation {
  lines: ReconcileLine[];
  /** 기준이 있는 항목 수 */
  checked: number;
  /** 그중 어긋난 항목 수 */
  mismatched: number;
  /** 기준이 하나라도 있고 전부 일치하면 true */
  ok: boolean;
}

/**
 * @param scan            발주서 구조 스캔 결과
 * @param outputQuantity  우리가 실제로 만든 ERP 엑셀의 총 수량
 * @param options         `includePackages` 가 false 면 포장 줄을 빼고 대조한다.
 *                        발주서 합계 행이 아닌 다른 기준으로 포장을 나눴을 때는
 *                        스캔이 읽은 포장과 화면의 포장이 달라 나란히 두면 혼동만 준다.
 */
export function reconcile(
  scan: OrderScan,
  outputQuantity: number | null = null,
  options: { includePackages?: boolean } = {},
): Reconciliation {
  const { includePackages = true } = options;
  const lines: ReconcileLine[] = [];

  for (const block of scan.blocks) {
    lines.push({
      scope: 'block',
      label: block.product_name || `블록 ${block.index + 1}`,
      declared: block.declared_quantity,
      actual: block.actual_quantity,
      ok: block.declared_quantity === null ? null : block.declared_quantity === block.actual_quantity,
    });
  }

  for (const pkg of includePackages ? scan.packages : []) {
    lines.push({
      scope: 'package',
      label: pkg.label?.trim() || `포장 ${pkg.index + 1}`,
      declared: pkg.declared_quantity,
      actual: pkg.actual_quantity,
      ok: pkg.declared_quantity === null ? null : pkg.declared_quantity === pkg.actual_quantity,
    });
  }

  lines.push({
    scope: 'total',
    label: '총계',
    declared: scan.declared_total,
    actual: scan.actual_total,
    ok: scan.declared_total === null ? null : scan.declared_total === scan.actual_total,
  });

  // 발주서에서 읽은 합과 실제로 엑셀에 쓴 합이 다르면 포장 배정에서 빠진 행이 있다는 뜻이다.
  if (outputQuantity !== null) {
    lines.push({
      scope: 'output',
      label: 'ERP 엑셀에 나간 수량',
      declared: scan.actual_total,
      actual: outputQuantity,
      ok: scan.actual_total === outputQuantity,
    });
  }

  const checked = lines.filter(l => l.ok !== null).length;
  const mismatched = lines.filter(l => l.ok === false).length;

  return { lines, checked, mismatched, ok: checked > 0 && mismatched === 0 };
}

/** 화면 머리말에 쓸 한 줄 요약 */
export function reconcileSummary(r: Reconciliation): string {
  if (r.checked === 0) return '발주서에 대조할 합계가 없어 검산을 건너뛰었습니다.';
  if (r.mismatched === 0) return `검산 ${r.checked}건 전부 일치합니다.`;
  return `검산 ${r.checked}건 중 ${r.mismatched}건이 발주서 합계와 다릅니다.`;
}
