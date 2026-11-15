import { STAGE_LABEL, type PoStage } from '@/lib/purchase-order/stage';

/**
 * DG 프리즘 대화용 "지금 시스템 현황" — 질문마다 서버가 DB 에서 세어 글로 만들어 AI 에게 준다 (2026-11-15).
 *
 * 사용자: "AI 기능이면 어떤 질문이든 다 답은 할 수 있어야지 — 동일유리 발주서에 관련해서는 전문가인 AI".
 * "요새 발주 상황 어떤 것 같니" 같은 물음에 답하려면 AI 가 회사 숫자를 봐야 한다. 숫자는 **서버가 센 값**이고
 * AI 는 그대로 옮기기만 한다(지어내지 않게). 대시보드 · 납품 화면과 같은 기준으로 센다.
 * 여기는 글 모양만 — DB 읽기는 snapshot-store.ts.
 */

export interface SnapshotPo {
  number: string;
  customer: string | null;
  site: string | null;
  stage: PoStage;
  /** 접수일 YYYY-MM-DD */
  created: string;
  assignee: string | null;
  stalledDays: number | null;
}

export interface SnapshotWorkOrder {
  number: string;
  customer: string | null;
  site: string | null;
  due: string | null;
  percent: number;
  /** 생산이 남은 수량(조) */
  remaining: number;
}

export interface SnapshotReady {
  number: string;
  customer: string | null;
  site: string | null;
  due: string | null;
  /** 만들어 놓고 아직 안 나간 수량(조) */
  ready: number;
}

export interface Snapshot {
  today: string;
  /** 발주 건 — 못 읽었으면 null */
  po: null | {
    counts: Partial<Record<PoStage, number>>;
    doneThisMonth: number;
    /** 주(월요일 시작)별 접수 건수, 오래된 주부터 */
    intakeWeeks: { week: string; count: number }[];
    /** 끝나지 않은 건 — 이름까지 볼 권한이 없으면 null(건수만) */
    open: SnapshotPo[] | null;
  };
  /** 작업의뢰서 — 생산이 남은 것 */
  workOrders: null | {
    active: number;
    remaining: number;
    deliveryOnly: number;
    byDue: SnapshotWorkOrder[];
  };
  production: null | {
    days: { date: string; qty: number; area: number }[];
    monthQty: number;
    monthArea: number;
  };
  /** 납품 — 생산 조회 권한이 있을 때만 */
  delivery: null | {
    monthQty: number;
    monthArea: number;
    todayQty: number;
    readyQty: number;
    readyOrders: SnapshotReady[];
  };
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
const md = (date: string | null) => (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : '없음');
const n = (v: number) => v.toLocaleString('ko-KR');
const m2 = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const who = (customer: string | null, site: string | null) => [customer, site].filter(Boolean).join(' · ') || '이름 없음';

/** 그 날이 든 주의 월요일 (YYYY-MM-DD) */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/** 접수일 목록 → 최근 weeks 주의 주별 건수 (오늘이 든 주까지) */
export function intakeByWeek(created: string[], today: string, weeks = 8): { week: string; count: number }[] {
  const thisMonday = mondayOf(today);
  const out = Array.from({ length: weeks }, (_, i) => ({
    week: new Date(Date.parse(`${thisMonday}T12:00:00Z`) - (weeks - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
    count: 0,
  }));
  const idx = new Map(out.map((w, i) => [w.week, i]));
  for (const c of created) {
    const i = idx.get(mondayOf(c));
    if (i !== undefined) out[i].count += 1;
  }
  return out;
}

const OPEN_STAGES: PoStage[] = ['submitted', 'checked', 'erp_ready', 'linking', 'producing'];

/** AI 에게 주는 현황 글 — 짧게, 숫자는 단위까지 */
export function snapshotText(s: Snapshot, limits = { po: 25, wo: 25, ready: 15 }): string {
  const out: string[] = [`기준 시각: ${s.today} (${weekdayOf(s.today)}) 한국 시간`];

  out.push('', '## 발주 건 (공사관리부가 올린 발주서가 접수부터 생산 완료까지 가는 건)');
  if (!s.po) out.push('- 읽지 못했습니다.');
  else {
    const open = OPEN_STAGES.reduce((t, st) => t + (s.po!.counts[st] ?? 0), 0);
    out.push(`- 진행 중 ${n(open)}건: ${OPEN_STAGES.map(st => `${STAGE_LABEL[st]} ${n(s.po!.counts[st] ?? 0)}`).join(' · ')}`);
    out.push(`- 이번 달 완료 ${n(s.po.doneThisMonth)}건`);
    out.push(`- 주별 접수(월요일 시작 주): ${s.po.intakeWeeks.map(w => `${md(w.week)}주 ${w.count}건`).join(', ')}`);
    if (s.po.open === null) out.push('- 건별 목록은 이 사람의 권한으로 볼 수 없습니다(건수만).');
    else if (s.po.open.length > 0) {
      out.push(`- 진행 중 목록 (최근 접수순${s.po.open.length > limits.po ? `, ${s.po.open.length}건 중 ${limits.po}건` : ''}):`);
      for (const p of s.po.open.slice(0, limits.po)) {
        out.push(`  - ${p.number} | ${who(p.customer, p.site)} | ${STAGE_LABEL[p.stage]} | 접수 ${md(p.created)}`
          + `${p.assignee ? ` | 담당 ${p.assignee}` : ''}${p.stalledDays != null ? ` | 이 단계 ${p.stalledDays}일째` : ''}`);
      }
    }
  }

  out.push('', '## 작업의뢰서 (생산이 남은 것)');
  if (!s.workOrders) out.push('- 읽지 못했습니다.');
  else {
    const w = s.workOrders;
    out.push(`- 생산이 남은 의뢰서 ${n(w.active)}건, 남은 수량 ${n(w.remaining)}조, 다 만들고 납품만 남은 의뢰서 ${n(w.deliveryOnly)}건`);
    if (w.byDue.length > 0) {
      out.push(`- 납기 가까운 순${w.byDue.length > limits.wo ? ` (${w.byDue.length}건 중 ${limits.wo}건)` : ''}:`);
      for (const o of w.byDue.slice(0, limits.wo)) {
        out.push(`  - ${o.number} | ${who(o.customer, o.site)} | 납기 ${md(o.due)} | 진행 ${o.percent}% | 남은 ${n(o.remaining)}조`);
      }
    }
  }

  out.push('', '## 생산 (복층 생산 실적, 수량 단위 조 · 면적 M²)');
  if (!s.production) out.push('- 읽지 못했습니다.');
  else {
    const p = s.production;
    out.push(`- 최근 ${p.days.length}일: ${p.days.map(d => `${md(d.date)}(${weekdayOf(d.date)}) ${n(d.qty)}조 ${m2(d.area)}M²`).join(', ')}`);
    out.push(`- 이번 달 합계 ${n(p.monthQty)}조 · ${m2(p.monthArea)}M²`);
  }

  out.push('', '## 납품');
  if (!s.delivery) out.push('- 이 사람의 권한으로는 볼 수 없습니다.');
  else {
    const d = s.delivery;
    out.push(`- 이번 달 납품 ${n(d.monthQty)}조 · ${m2(d.monthArea)}M², 오늘 ${n(d.todayQty)}조`);
    out.push(`- 바로 나갈 수 있는 수량(생산했는데 아직 안 나간 것) ${n(d.readyQty)}조, 의뢰서 ${n(d.readyOrders.length)}건`);
    for (const r of d.readyOrders.slice(0, limits.ready)) {
      out.push(`  - ${r.number} | ${who(r.customer, r.site)} | 납기 ${md(r.due)} | 바로 나갈 ${n(r.ready)}조`);
    }
  }
  return out.join('\n');
}
