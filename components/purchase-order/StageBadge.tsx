import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STAGE_LABEL, STEPS, STEPS_SHORT, STEP_INDEX, type PoStage } from '@/lib/purchase-order/stage';

const VARIANT: Record<PoStage, 'secondary' | 'info' | 'warning' | 'success' | 'outline'> = {
  submitted: 'warning',
  checked: 'info',
  erp_ready: 'info',
  linking: 'info',
  producing: 'info',
  done: 'success',
  cancelled: 'outline',
};

/** 발주 건 단계 — 멈춰 있으면 며칠째인지 붙인다 */
export function StageBadge({ stage, stalledDays }: { stage: PoStage; stalledDays?: number | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={VARIANT[stage]}>{STAGE_LABEL[stage]}</Badge>
      {stalledDays != null && (
        <Badge variant="destructive" title="이 단계에서 오래 머물러 있습니다">{stalledDays}일째</Badge>
      )}
    </span>
  );
}

/**
 * 여섯 칸 진행 막대 — 접수 · 확인 · ERP 엑셀 · 작업의뢰서 · 생산 · 완료.
 * compact 는 목록 한 줄에 들어가는 점 막대.
 */
export function StageSteps({ stage, compact = false }: { stage: PoStage; compact?: boolean }) {
  const at = STEP_INDEX[stage];
  if (compact) {
    return (
      <div className="flex items-center gap-1" title={STEPS[at] ?? '취소'}>
        {STEPS.map((s, i) => (
          <span key={s} className={cn('h-1.5 w-5 rounded-full',
            stage === 'cancelled' ? 'bg-border' : i <= at ? (stage === 'done' ? 'bg-success' : 'bg-brand-600') : 'bg-border')} />
        ))}
      </div>
    );
  }
  return (
    <ol className="grid grid-cols-6 gap-1.5">
      {STEPS.map((s, i) => {
        const done = stage !== 'cancelled' && i < at;
        const current = stage !== 'cancelled' && i === at;
        return (
          <li key={s} className="min-w-0">
            <div className={cn('h-2 rounded-full',
              stage === 'done' ? 'bg-success' : done || current ? 'bg-brand-600' : 'bg-border')} />
            <p className={cn('mt-1.5 truncate text-center text-xs',
              current ? 'font-bold text-brand-800' : done ? 'text-foreground' : 'text-muted-foreground')}>
              <span className="sm:hidden">{STEPS_SHORT[i]}</span><span className="hidden sm:inline">{s}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
