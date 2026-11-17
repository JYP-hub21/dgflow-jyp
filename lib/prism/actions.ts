import { daysBetween, isIsoDate } from '@/lib/production/daily-report';
import { weekOf } from '@/lib/production/weekly';
import type { PrismAction } from './chat';

/**
 * DG 프리즘이 "해 주는 일" — 엑셀 다운로드 · 화면 열기 (2026-11-17).
 *
 * 사용자: "프리즘에서 좀 고도화된 질문도 받아줄 수 있나? 일일생산일지 4월 며칠부터 10월까지 다운로드해줘 뭐 이렇게"
 *        → "난 이런 거 다 되게 만들어달라는 거야".
 *
 * AI 는 무엇을 할지(kind)와 날짜 · 의뢰번호만 고른다. 주소 · 버튼 글은 여기서 만든다 — AI 가 없는 주소를 지어내지 못하게.
 * 날짜가 틀렸거나, 그 기간에 자료가 없거나, 의뢰번호가 없으면 버튼을 만들지 않고 까닭(notes)을 돌려준다.
 * 자료를 바꾸는 일(등록 · 수정 · 삭제)은 여기 넣지 않는다 — 버튼은 내려받기와 화면 열기뿐이다.
 */

export const ACTION_KINDS = [
  'download_bokcheung', 'download_weekly',
  'open_bokcheung', 'open_weekly', 'open_period', 'open_stock',
  'open_work_order', 'open_production_input',
  'search_work_orders', 'search_production', 'search_deliveries',
] as const;
export type ActionKind = typeof ACTION_KINDS[number];

/** AI 가 고른 일 — 쓰지 않는 칸은 빈 글 */
export interface RawAction { kind: ActionKind; from: string; to: string; query: string }

export interface ActionFacts {
  /** 생산 기록이 있는 첫 날 · 마지막 날 (없으면 null) */
  dataFrom: string | null;
  dataTo: string | null;
  /** 의뢰번호 → 작업의뢰서 id (wantedNumbers 로 물어 온 것) */
  workOrders: Map<string, string>;
  /** 생산 현황을 볼 권한 — 생산일지 엑셀 · 납품 화면에 필요하다 */
  canProduction: boolean;
}

export const MAX_ACTIONS = 3;
const MAX_DAYS = 366;
const NEEDS_NUMBER: ActionKind[] = ['open_work_order', 'open_production_input'];
const NEEDS_PRODUCTION: ActionKind[] = ['download_bokcheung', 'download_weekly', 'open_bokcheung', 'open_weekly', 'open_period', 'open_stock', 'search_deliveries'];

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]})`;
const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 번호로 여는 일에 적힌 의뢰번호들 — 서버가 이 번호의 id 를 찾아 facts.workOrders 로 준다 */
export function wantedNumbers(raw: RawAction[]): string[] {
  return [...new Set(raw.filter(a => NEEDS_NUMBER.includes(a.kind)).map(a => clean(a.query)).filter(Boolean))];
}

function range(a: RawAction): { from: string; to: string } | string {
  const from = clean(a.from), to = clean(a.to) || clean(a.from);
  if (!isIsoDate(from) || !isIsoDate(to)) return '기간을 알아듣지 못했습니다. 날짜를 다시 말씀해 주세요.';
  const r = from <= to ? { from, to } : { from: to, to: from };
  if (daysBetween(r.from, r.to) > MAX_DAYS) return `한 번에 ${MAX_DAYS}일까지 받을 수 있습니다. 기간을 나눠서 말씀해 주세요.`;
  return r;
}

/** 기간에 생산 기록이 하나도 없을 수밖에 없으면 그 까닭 */
function noData(from: string, to: string, f: ActionFacts): string | null {
  if (!f.dataFrom || !f.dataTo) return '아직 들어 있는 생산 기록이 없습니다.';
  if (to < f.dataFrom || from > f.dataTo) return `${from} – ${to} 에는 생산 기록이 없습니다. 지금 들어 있는 생산 기록은 ${f.dataFrom} – ${f.dataTo} 입니다.`;
  return null;
}

/** AI 가 고른 일들을 확인해 버튼으로 — 못 만드는 것은 notes 에 까닭을 적는다 */
export function resolveActions(raw: RawAction[], f: ActionFacts): { actions: PrismAction[]; notes: string[] } {
  const actions: PrismAction[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const push = (a: PrismAction) => {
    const key = a.type === 'open' ? a.href : `${a.kind}|${a.from}|${a.to}`;
    if (seen.has(key) || actions.length >= MAX_ACTIONS) return;
    seen.add(key);
    actions.push(a);
  };
  const note = (t: string) => { if (!notes.includes(t)) notes.push(t); };

  for (const a of raw) {
    if (!ACTION_KINDS.includes(a.kind)) continue;
    if (NEEDS_PRODUCTION.includes(a.kind) && !f.canProduction) { note('생산 현황을 볼 권한이 없어 이 일은 해 드릴 수 없습니다.'); continue; }
    const q = clean(a.query).slice(0, 60);
    switch (a.kind) {
      case 'download_bokcheung': {
        const r = range(a);
        if (typeof r === 'string') { note(r); break; }
        const none = noData(r.from, r.to, f);
        if (none) { note(none); break; }
        push({
          type: 'download', kind: 'bokcheung', from: r.from, to: r.to, label: '복층생산일지 엑셀 다운로드',
          detail: r.from === r.to ? md(r.from) : `${r.from} – ${r.to} · 생산이 있는 날마다 시트 한 장`,
        });
        break;
      }
      case 'download_weekly': {
        if (!isIsoDate(clean(a.from))) { note('어느 주인지 알아듣지 못했습니다. 날짜를 다시 말씀해 주세요.'); break; }
        const w = weekOf(clean(a.from));
        const none = noData(w.monday, w.saturday, f);
        if (none) { note(none); break; }
        push({ type: 'download', kind: 'weekly', from: w.monday, to: w.saturday, label: '주간생산일지 엑셀 다운로드', detail: `${md(w.monday)} – ${md(w.saturday)} 주` });
        break;
      }
      case 'open_bokcheung': {
        if (!isIsoDate(clean(a.from))) { note('날짜를 알아듣지 못했습니다.'); break; }
        push({ type: 'open', href: `/production/report?date=${clean(a.from)}`, label: '복층생산일지 열기', detail: md(clean(a.from)) });
        break;
      }
      case 'open_weekly': {
        if (!isIsoDate(clean(a.from))) { note('어느 주인지 알아듣지 못했습니다.'); break; }
        const w = weekOf(clean(a.from));
        push({ type: 'open', href: `/production/report?view=weekly&date=${w.monday}`, label: '주간생산일지 열기', detail: `${md(w.monday)} – ${md(w.saturday)} 주` });
        break;
      }
      case 'open_period': {
        const r = range(a);
        if (typeof r === 'string') { note(r); break; }
        push({ type: 'open', href: `/production/report?view=period&from=${r.from}&to=${r.to}`, label: '기간 합계 열기', detail: `${r.from} – ${r.to}` });
        break;
      }
      case 'open_stock':
        push({ type: 'open', href: '/deliveries?view=stock', label: '미납품 재고 열기', detail: '현장별 재고 · 엑셀 다운로드' });
        break;
      case 'open_work_order':
      case 'open_production_input': {
        if (!q) { note('의뢰번호를 알려 주세요.'); break; }
        const id = f.workOrders.get(q);
        if (!id) { note(`의뢰번호 ${q} 작업의뢰서를 찾지 못했습니다.`); break; }
        push(a.kind === 'open_work_order'
          ? { type: 'open', href: `/work-orders/${id}`, label: `작업의뢰서 ${q} 열기`, detail: '품목 · 생산 · 납품 내역' }
          : { type: 'open', href: `/production/${id}`, label: `${q} 생산 입력 열기`, detail: '품목별 생산 수량 입력' });
        break;
      }
      case 'search_work_orders':
      case 'search_production':
      case 'search_deliveries': {
        if (!q) break;
        const [path, name] = a.kind === 'search_work_orders' ? ['/work-orders', '작업의뢰서']
          : a.kind === 'search_production' ? ['/production', '생산 현황'] : ['/deliveries', '납품'];
        push({ type: 'open', href: `${path}?q=${encodeURIComponent(q)}`, label: `${name}에서 검색`, detail: `"${q}"` });
        break;
      }
    }
  }
  return { actions, notes };
}
