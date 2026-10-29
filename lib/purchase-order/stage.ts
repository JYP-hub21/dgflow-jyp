/**
 * 발주 건의 단계.
 *
 *   접수 → 확인 → ERP 엑셀 → 작업의뢰서 → 생산 → 완료
 *
 * 앞의 셋(접수 · 확인 · ERP 엑셀 완성)은 사람이 한 일이라 DB 에 저장한다 (`stage` 열).
 * 뒤의 셋은 연결된 작업의뢰서에서 **계산한다** — 생산 실적을 저장할 때마다 발주 건까지
 * 고치러 가면 두 곳이 어긋난다. 작업의뢰서가 진실이고 발주 건은 그걸 비춰 본다.
 */

export type StoredStage = 'submitted' | 'checked' | 'erp_ready' | 'cancelled';
export type PoStage = 'submitted' | 'checked' | 'erp_ready' | 'linking' | 'producing' | 'done' | 'cancelled';

export const STAGE_LABEL: Record<PoStage, string> = {
  submitted: '확인 전',
  checked: '확인함',
  erp_ready: 'ERP 등록 대기',
  linking: '작업의뢰서 받는 중',
  producing: '생산 중',
  done: '완료',
  cancelled: '취소',
};

/** 진행 막대에 그리는 여섯 칸 */
export const STEPS = ['접수', '확인', 'ERP 엑셀', '작업의뢰서', '생산', '완료'] as const;
/** 폰 폭(390px)에서 여섯 칸에 들어가는 짧은 이름 */
export const STEPS_SHORT = ['접수', '확인', 'ERP', '의뢰서', '생산', '완료'] as const;

/** 이 단계면 진행 막대가 몇 칸째까지 찼나 (0부터) */
export const STEP_INDEX: Record<PoStage, number> = {
  submitted: 0,
  checked: 1,
  erp_ready: 2,
  linking: 3,
  producing: 4,
  done: 5,
  cancelled: -1,
};

export interface PackageProgress {
  work_order_id: string | null;
  /** 연결된 작업의뢰서의 총 수량 · 생산 수량 */
  total?: number;
  produced?: number;
}

export function deriveStage(stored: StoredStage, packages: PackageProgress[]): PoStage {
  if (stored === 'cancelled') return 'cancelled';
  if (packages.length === 0) return stored;

  const linked = packages.filter(p => p.work_order_id);
  if (linked.length === 0) return stored === 'submitted' ? 'submitted' : 'erp_ready';
  if (linked.length < packages.length) return 'linking';

  const done = linked.every(p => (p.total ?? 0) > 0 && (p.produced ?? 0) >= (p.total ?? 0));
  return done ? 'done' : 'producing';
}

/** 이 단계에서 다음 사람이 손을 대야 하는데 너무 오래 머물렀나 (일 수) */
const STALL_DAYS: Partial<Record<PoStage, number>> = {
  submitted: 1, // 담당자가 아직 안 열어 봄
  checked: 2,   // 열어 봤는데 ERP 엑셀이 안 나옴
  erp_ready: 2, // ERP 엑셀은 나왔는데 작업의뢰서가 안 돌아옴
  linking: 3,
};

export interface StallInput {
  stage: PoStage;
  created_at: string;
  checked_at: string | null;
  erp_saved_at: string | null;
}

/** 지금 단계에 들어온 때 */
export function stageSince(p: StallInput): string {
  if (p.stage === 'checked') return p.checked_at ?? p.created_at;
  if (p.stage === 'erp_ready' || p.stage === 'linking') return p.erp_saved_at ?? p.checked_at ?? p.created_at;
  return p.created_at;
}

/** 멈춰 있는 날 수. 기준을 넘지 않았으면 null */
export function stalledDays(p: StallInput, now = new Date()): number | null {
  const limit = STALL_DAYS[p.stage];
  if (limit === undefined) return null;
  const days = Math.floor((now.getTime() - new Date(stageSince(p)).getTime()) / 86_400_000);
  return days >= limit ? days : null;
}
