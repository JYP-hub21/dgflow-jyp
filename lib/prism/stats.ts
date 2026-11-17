/**
 * DG 프리즘 조회 도구의 집계 — 기간의 생산 · 납품을 날 · 주 · 달 · 호기 · 거래처 따위로 묶는다 (2026-11-17).
 * 숫자는 여기서(서버가) 세고 AI 는 옮기기만 한다. DB 읽기는 tools.ts.
 */

export const GROUPS = ['total', 'day', 'week', 'month', 'line', 'shift', 'customer', 'site', 'product', 'work_order'] as const;
export type GroupBy = typeof GROUPS[number];

export interface StatInput {
  date: string;
  qty: number;
  area: number;
  line?: number | null;
  shift?: string | null;
  customer?: string | null;
  site?: string | null;
  product?: string | null;
  number?: string | null;
}

export interface StatRow { key: string; qty: number; area: number }
export interface StatResult {
  rows: StatRow[];
  total: { qty: number; area: number };
  /** 기록이 있는 날 수 */
  days: number;
  /** 줄 수 한도를 넘어 '그 밖' 으로 합친 묶음 수 */
  folded: number;
}

/** 그 날이 든 주의 월요일 */
function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

function keyOf(r: StatInput, by: GroupBy): string {
  switch (by) {
    case 'total': return '합계';
    case 'day': return r.date;
    case 'week': return `${mondayOf(r.date)} 주`;
    case 'month': return r.date.slice(0, 7);
    case 'line': return r.line ? `${r.line}호기` : '호기 모름';
    case 'shift': return r.shift === 'night' ? '야간' : '주간';
    case 'customer': return r.customer || '거래처 없음';
    case 'site': return [r.customer, r.site].filter(Boolean).join(' · ') || '현장 없음';
    case 'product': return r.product || '품명 없음';
    case 'work_order': return [r.number, r.customer, r.site].filter(Boolean).join(' · ') || '의뢰번호 없음';
  }
}

const TIME: GroupBy[] = ['day', 'week', 'month'];
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * 묶어서 센다. 날 · 주 · 달은 시간순, 나머지는 수량 많은 순.
 * 줄이 limit 을 넘으면 — 시간순은 그대로 다 주고(한 해 366줄까지), 나머지는 위에서 limit 개만 남기고 '그 밖' 한 줄로 합친다.
 */
export function aggregate(input: StatInput[], by: GroupBy, limit = 40): StatResult {
  const map = new Map<string, StatRow>();
  const days = new Set<string>();
  let qty = 0, area = 0;
  for (const r of input) {
    if (!(r.qty > 0)) continue;
    days.add(r.date);
    qty += r.qty;
    area += r.area || 0;
    const key = keyOf(r, by);
    const row = map.get(key);
    if (row) { row.qty += r.qty; row.area += r.area || 0; } else map.set(key, { key, qty: r.qty, area: r.area || 0 });
  }
  let rows = [...map.values()];
  let folded = 0;
  if (TIME.includes(by)) rows.sort((a, b) => a.key.localeCompare(b.key));
  else {
    rows.sort((a, b) => b.qty - a.qty || a.key.localeCompare(b.key, 'ko'));
    if (rows.length > limit) {
      const rest = rows.slice(limit);
      folded = rest.length;
      rows = [...rows.slice(0, limit), { key: `그 밖 ${rest.length}곳`, qty: rest.reduce((s, r) => s + r.qty, 0), area: rest.reduce((s, r) => s + r.area, 0) }];
    }
  }
  return { rows: rows.map(r => ({ ...r, area: round2(r.area) })), total: { qty, area: round2(area) }, days: days.size, folded };
}

const n = (v: number) => v.toLocaleString('ko-KR');
const m2 = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });

/** AI 에게 줄 글 — 단위까지 */
export function statText(title: string, res: StatResult, unit = '조'): string {
  if (res.total.qty === 0) return `${title}\n- 기록이 없습니다.`;
  const lines = [`${title}`, `- 합계 ${n(res.total.qty)}${unit} · ${m2(res.total.area)}M² · 기록이 있는 날 ${res.days}일`];
  if (res.rows.length > 1 || res.rows[0]?.key !== '합계') {
    for (const r of res.rows) lines.push(`  - ${r.key} | ${n(r.qty)}${unit} | ${m2(r.area)}M²`);
  }
  return lines.join('\n');
}
