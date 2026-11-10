import type { PoStage } from './stage';

/**
 * '끝난 건 정리' — 끝난 발주 건(완료 · 취소)의 파일을 저장소에서 지울 계획.
 *
 * 2026-11-10 점검: '완료' 는 **지금 있는 포장이 다 이어지고 다 만들어졌다** 는 뜻이라, 발주서에 차수가 여럿인데
 * 하나만 ERP 로 만들어 이은 건도 완료가 된다. 그런 건의 원본을 지우면 되살릴 수 없다. 완료의 뜻은 규칙을 정할
 * 때까지 바꾸지 않고, 대신 **지울 발주 건을 이름 · 접수번호로 다 보여 주고 사람이 고른 것만** 지운다.
 * '완료가 된 지 며칠 안 된 건 빼기' 는 완료 시각이 저장돼 있지 않아(단계는 계산값) 넣지 않았다.
 */

export interface CleanupFileRow {
  id: string;
  purchase_order_id: string;
  kind: string;
  file_name: string;
  size_bytes: number | string;
  storage_prefix: string;
  chunk_count: number;
  purged_at: string | null;
}

export interface CleanupPoRow {
  id: string;
  intake_number: string;
  site_name: string | null;
  customer_name: string | null;
  derived: PoStage;
  packages_linked: number;
}

/** 화면 확인 창에 한 줄로 보이는 발주 건 */
export interface CleanupOrder {
  id: string;
  intake_number: string;
  /** 현장 · 거래처 (없으면 빈 글자) */
  name: string;
  state: 'done' | 'cancelled';
  /** 이어진 작업의뢰서 수 */
  work_orders: number;
  /** 지워질 발주서 원본 파일 이름 */
  order_files: string[];
  /** 지워질 ERP 업로드 · 규격정리 파일 수 */
  made_files: number;
  files: number;
  bytes: number;
}

export interface CleanupPlan {
  /** 아직 안 지운 파일 전체 크기 */
  used: number;
  orders: CleanupOrder[];
  /** 지울 수 있는 파일 (끝난 건의 안 지운 파일) */
  purgeable: CleanupFileRow[];
}

const isFinished = (s: PoStage): s is 'done' | 'cancelled' => s === 'done' || s === 'cancelled';

export function cleanupPlan(pos: CleanupPoRow[], files: CleanupFileRow[]): CleanupPlan {
  const live = files.filter(f => !f.purged_at);
  const finished = new Map(pos.filter(p => isFinished(p.derived)).map(p => [p.id, p]));
  const purgeable = live.filter(f => finished.has(f.purchase_order_id));

  const orders: CleanupOrder[] = [];
  for (const p of pos) {
    if (!isFinished(p.derived)) continue;
    const mine = purgeable.filter(f => f.purchase_order_id === p.id);
    if (mine.length === 0) continue;
    orders.push({
      id: p.id,
      intake_number: p.intake_number,
      name: [p.site_name, p.customer_name].filter(Boolean).join(' · '),
      state: p.derived,
      work_orders: p.packages_linked,
      order_files: mine.filter(f => f.kind === 'order').map(f => f.file_name),
      made_files: mine.filter(f => f.kind !== 'order').length,
      files: mine.length,
      bytes: mine.reduce((n, f) => n + Number(f.size_bytes), 0),
    });
  }
  return { used: live.reduce((n, f) => n + Number(f.size_bytes), 0), orders, purgeable };
}

/** 사람이 확인 창에서 고른 발주 건의 파일만 — 그사이 진행 중으로 돌아간 건은 고른 목록에 있어도 빠진다 */
export function pickPurgeable(plan: CleanupPlan, selectedPoIds: string[]): CleanupFileRow[] {
  const chosen = new Set(selectedPoIds);
  return plan.purgeable.filter(f => chosen.has(f.purchase_order_id));
}
