import { Badge } from '@/components/ui/badge';
import { STAGE_LABELS, workOrderStage, type StageTotals, type WorkOrderStage } from '@/lib/work-order/stage';

const VARIANTS: Record<WorkOrderStage, 'secondary' | 'info' | 'warning' | 'success'> = {
  waiting: 'secondary',
  producing: 'info',
  produced: 'warning',
  delivering: 'info',
  delivered: 'success',
  done: 'success',
};

/** 작업의뢰서 상태 — 수량에서 계산한다: 대기 · 생산 중 · 생산 완료 · 납품 중 · 납품 완료 */
export default function WorkOrderStatusBadge({ status, totals }: { status: string; totals: StageTotals }) {
  const stage = workOrderStage(status, totals);
  return <Badge variant={VARIANTS[stage]}>{STAGE_LABELS[stage]}</Badge>;
}
