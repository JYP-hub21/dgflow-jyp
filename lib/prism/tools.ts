import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll, fetchAllIn } from '@/lib/supabase/fetch-all';
import { hasPermission, type PermissionSubject } from '@/lib/auth/role-guard';
import { daysBetween, isIsoDate } from '@/lib/production/daily-report';
import { fetchProductionLogs } from '@/lib/production/logs';
import { loadDeliveries, loadDeliveriesBetween } from '@/lib/production/delivery-store';
import { deliveredByItem, deliveredByWorkOrder } from '@/lib/production/delivery';
import { MES_TABLE } from '@/lib/production/mes';
import { isMesOrder } from '@/lib/production/mes-orders';
import { itemNo } from '@/lib/production/item-view';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import { aggregate, GROUPS, statText, type GroupBy, type StatInput } from './stats';

/**
 * DG 프리즘의 조회 도구 (2026-11-17) — 현황 글(snapshot)에 없는 것을 AI 가 직접 찾아본다.
 *
 * 사용자: "프리즘에서 좀 고도화된 질문도 받아줄 수 있나" → 지난달 · 특정 기간 · 월별 · 호기별 · 거래처별 실적, 특정 의뢰서 찾기.
 * 전부 읽기만 한다. 숫자는 여기서 센 값이고 AI 는 옮기기만 한다(lib/prism/knowledge.ts 의 규칙).
 * 권한: 생산 · 작업의뢰서는 대시보드처럼 누구나, 납품은 생산 조회 권한이 있을 때만 (snapshot-store.ts 와 같다).
 */

const MAX_DAYS = 366;
const DATE = { type: 'string', description: 'YYYY-MM-DD' } as const;

/** Messages API 에 주는 도구 정의 — strict 라 모든 칸이 필수고 additionalProperties 는 false */
export const PRISM_TOOLS = [
  {
    name: 'production_stats',
    description: '기간의 복층 생산 실적을 센다(수량 조 · 면적 M²). 현황 글에는 최근 14일 · 이번 달만 있으므로, 그 밖의 기간이나 '
      + '월별 · 주별 · 호기별 · 주야간별 · 거래처별 · 현장별 · 품명별 · 의뢰서별 실적을 물으면 이 도구로 센다. 기간은 양 끝 포함, 최대 366일.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        from: DATE, to: DATE,
        group_by: { type: 'string', enum: [...GROUPS], description: 'total=합계만, day/week/month=날 · 주 · 달별, line=호기별, shift=주야간별, customer=거래처별, site=현장별, product=품명별, work_order=의뢰서별' },
      },
      required: ['from', 'to', 'group_by'],
      additionalProperties: false,
    },
  },
  {
    name: 'delivery_stats',
    description: '기간의 납품(출고) 실적을 센다(수량 조 · 면적 M²). 날 · 주 · 달별, 거래처 · 현장 · 의뢰서별. 기간은 양 끝 포함, 최대 366일.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        from: DATE, to: DATE,
        group_by: { type: 'string', enum: ['total', 'day', 'week', 'month', 'customer', 'site', 'work_order'] },
      },
      required: ['from', 'to', 'group_by'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_work_orders',
    description: '작업의뢰서를 의뢰번호 · 거래처 · 현장 이름의 일부로 찾는다(끝난 것 포함). 의뢰번호 · 거래처 · 현장 · 의뢰일 · 납기 · 상태 · 의뢰/생산/납품 수량을 최대 15건 돌려준다.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '의뢰번호나 거래처 · 현장 이름의 일부 (예: 26-25, 현장 이름 두세 글자)' },
        status: { type: 'string', enum: ['all', 'open', 'completed'], description: 'open=진행 중, completed=끝난 것' },
      },
      required: ['query', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'work_order_detail',
    description: '의뢰번호 하나의 작업의뢰서를 품목까지 본다 — 품목별 품명 · 규격 · 의뢰/생산/납품 수량, 생산한 날. 의뢰번호를 정확히 알아야 한다(모르면 find_work_orders 먼저).',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { number: { type: 'string', description: '의뢰번호 (예: 26-2573)' } },
      required: ['number'],
      additionalProperties: false,
    },
  },
];

export interface ToolContext {
  user: PermissionSubject;
  /** 서비스 권한 클라이언트 — 읽기만 한다 */
  service: SupabaseClient;
}

const WO_SELECT = `id, work_order_number, status, request_date, delivery_date, customer_label, site_label, notes,
  order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name))`;

const n = (v: number) => v.toLocaleString('ko-KR');
const STATUS: Record<string, string> = { pending: '대기', in_progress: '진행 중', completed: '완료' };
const term = (q: string) => q.replace(/["\\,()%*]/g, ' ').trim().slice(0, 60);

function period(input: Record<string, unknown>): { from: string; to: string } | string {
  const from = String(input.from ?? ''), to = String(input.to ?? '');
  if (!isIsoDate(from) || !isIsoDate(to)) return '기간을 YYYY-MM-DD 로 주어야 합니다.';
  if (from > to) return '시작일이 종료일보다 늦습니다.';
  if (daysBetween(from, to) > MAX_DAYS) return `기간은 최대 ${MAX_DAYS}일입니다. 나눠서 물어보세요.`;
  return { from, to };
}

export interface DataRange {
  /** 생산 기록이 있는 첫 날 · 마지막 날 (생산 기록 + MES 실적) */
  from: string | null;
  to: string | null;
  /**
   * 이 날부터는 온전하다 — 그 앞은 일부만 들어 있다. MES 생산실적을 기간을 골라 넣으면 그 기간의 의뢰서는 통째로 들어가
   * 기간 앞의 생산분도 따라 들어오는데, 그 앞 날짜에는 다른 의뢰서의 생산이 빠져 있어 실제보다 훨씬 적다. 온전하면 null.
   */
  partialBefore: string | null;
}

/** AI 에게 주는 한 줄 — 자료가 어디서 어디까지 있고, 어디부터 온전한지 */
export function dataRangeText(r: DataRange): string {
  if (!r.from || !r.to) return '아직 없음';
  return `${r.from} – ${r.to} (이 밖의 날짜는 자료가 없다)`
    + (r.partialBefore ? `. 단 ${r.partialBefore} 앞의 날짜는 일부 작업의뢰서의 생산분만 들어 있어 실제 생산량보다 훨씬 적다 — `
      + `그 날짜가 낀 숫자를 말할 때는 "${r.partialBefore} 앞은 일부만 들어 있다" 고 꼭 밝히고, 그 앞뒤를 견주어 늘었다 · 줄었다 · 멈췄다고 해석하지 않는다` : '');
}

export async function productionDataRange(service: SupabaseClient): Promise<DataRange> {
  const edge = async (table: string, ascending: boolean) => {
    const { data, error } = await service.from(table).select('production_date').order('production_date', { ascending }).limit(1);
    return error ? null : ((data?.[0] as { production_date?: string } | undefined)?.production_date ?? null);
  };
  const [a1, a2, b1, b2] = await Promise.all([
    edge('dgflow_production_logs', true), edge(MES_TABLE, true), edge('dgflow_production_logs', false), edge(MES_TABLE, false),
  ]);
  const firsts = [a1, a2].filter((d): d is string => !!d).sort();
  const lasts = [b1, b2].filter((d): d is string => !!d).sort();
  return { from: firsts[0] ?? null, to: lasts.at(-1) ?? null, partialBefore: a1 && a2 && a1 < a2 ? a2 : null };
}

/** 의뢰번호 → 작업의뢰서 id (버튼을 만들 때 쓴다) */
export async function workOrderIds(service: SupabaseClient, numbers: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (numbers.length === 0) return out;
  const { data } = await service.from('dgflow_work_orders').select('id, work_order_number').in('work_order_number', numbers.slice(0, 20));
  for (const r of data ?? []) out.set(r.work_order_number as string, r.id as string);
  return out;
}

async function productionStats(ctx: ToolContext, input: Record<string, unknown>): Promise<string> {
  const p = period(input);
  if (typeof p === 'string') return p;
  const by = GROUPS.includes(input.group_by as GroupBy) ? input.group_by as GroupBy : 'total';
  const logs = await fetchProductionLogs(ctx.service, p.from, p.to);
  const rows: StatInput[] = logs.filter(l => !l.insulated_total).map(l => ({
    date: l.production_date, qty: l.quantity_completed, area: Number(l.area_m2 || 0), line: l.line_number, shift: l.shift,
    customer: l.customer, site: l.site, product: l.product_name, number: l.work_order_number,
  }));
  const text = statText(`복층 생산 ${p.from} – ${p.to} (${by})`, aggregate(rows, by));
  const range = await productionDataRange(ctx.service);
  if (rows.length === 0) return `${text}\n- 생산 기록이 들어 있는 기간: ${dataRangeText(range)}`;
  return range.partialBefore && p.from < range.partialBefore
    ? `${text}\n- 주의: ${range.partialBefore} 앞의 날짜는 일부 작업의뢰서의 생산분만 들어 있다(실제 생산량보다 훨씬 적다). 그 날짜의 숫자는 "일부만 들어 있다" 고 밝히고 추세로 해석하지 않는다.`
    : text;
}

async function deliveryStats(ctx: ToolContext, input: Record<string, unknown>): Promise<string> {
  if (!hasPermission(ctx.user, 'production:view')) return '이 사람은 납품 기록을 볼 권한이 없습니다.';
  const p = period(input);
  if (typeof p === 'string') return p;
  const by = (['total', 'day', 'week', 'month', 'customer', 'site', 'work_order'] as GroupBy[]).includes(input.group_by as GroupBy) ? input.group_by as GroupBy : 'total';
  const { logs, storage } = await loadDeliveriesBetween(ctx.service, p.from, p.to);
  if (storage === 'none') return '납품 기록 표가 아직 없습니다.';
  const names = new Map<string, { number: string; customer: string | null; site: string | null }>();
  if (by === 'customer' || by === 'site' || by === 'work_order') {
    const ids = [...new Set(logs.map(l => l.work_order_id))];
    const orders = await fetchAllIn<Record<string, unknown>>(ids, (chunk, a, b) => ctx.service.from('dgflow_work_orders')
      .select(WO_SELECT).in('id', chunk).order('id').range(a, b));
    for (const wo of orders) {
      const labels = workOrderLabels(wo as unknown as WorkOrderLabelSource);
      names.set(wo.id as string, { number: wo.work_order_number as string, customer: labels.customer ?? null, site: labels.site ?? null });
    }
  }
  const rows: StatInput[] = logs.map(l => {
    const o = names.get(l.work_order_id);
    return { date: l.delivery_date, qty: l.quantity, area: Number(l.area_m2 || 0), customer: o?.customer, site: o?.site, number: o?.number };
  });
  const text = statText(`납품 ${p.from} – ${p.to} (${by})`, aggregate(rows, by));
  return rows.length > 0 ? text : `${text}\n- MES 생산실적으로 넣은 지난 작업의뢰서는 출고 자료가 없어 납품 기록이 없습니다(완료로만 들어가 있습니다).`;
}

interface WoRow extends Record<string, unknown> {
  id: string; work_order_number: string; status: string; request_date: string | null; delivery_date: string | null; notes: string | null;
  items?: { id: string; quantity: number | null; produced_quantity: number | null }[] | null;
}

async function findWorkOrders(ctx: ToolContext, input: Record<string, unknown>): Promise<string> {
  const q = term(String(input.query ?? ''));
  if (!q) return '찾을 말을 주어야 합니다.';
  let query = ctx.service.from('dgflow_work_orders')
    .select(`${WO_SELECT}, items:dgflow_work_order_items(id, quantity, produced_quantity)`, { count: 'exact' })
    .or(['work_order_number', 'site_label', 'customer_label'].map(c => `${c}.ilike."%${q}%"`).join(','));
  if (input.status === 'open') query = query.in('status', ['pending', 'in_progress']);
  if (input.status === 'completed') query = query.eq('status', 'completed');
  const { data, count, error } = await query.order('request_date', { ascending: false }).order('id').limit(15);
  if (error) return `찾지 못했습니다: ${error.message}`;
  const rows = (data ?? []) as unknown as WoRow[];
  if (rows.length === 0) return `"${q}" 로 찾은 작업의뢰서가 없습니다.`;
  const delivered = hasPermission(ctx.user, 'production:view')
    ? deliveredByWorkOrder((await loadDeliveries(ctx.service, rows.map(r => r.id))).logs)
    : null;
  const lines = [`"${q}" 작업의뢰서 ${n(count ?? rows.length)}건${(count ?? 0) > rows.length ? ` 중 최근 ${rows.length}건` : ''}:`];
  for (const r of rows) {
    const labels = workOrderLabels(r as unknown as WorkOrderLabelSource);
    const qty = (r.items ?? []).reduce((s, i) => s + (i.quantity ?? 0), 0);
    const produced = (r.items ?? []).reduce((s, i) => s + Math.min(i.produced_quantity ?? 0, i.quantity ?? 0), 0);
    lines.push(`  - ${r.work_order_number} | ${[labels.customer, labels.site].filter(Boolean).join(' · ') || '이름 없음'} | 의뢰일 ${r.request_date ?? '없음'} | 납기 ${r.delivery_date ?? '없음'}`
      + ` | ${STATUS[r.status] ?? r.status}${isMesOrder(r.notes) ? '(MES 생산실적으로 등록)' : ''} | 의뢰 ${n(qty)}조 · 생산 ${n(produced)}조`
      + `${delivered ? ` · 납품 ${n(delivered.get(r.id) ?? 0)}조` : ''} | 품목 ${(r.items ?? []).length}개`);
  }
  return lines.join('\n');
}

async function workOrderDetail(ctx: ToolContext, input: Record<string, unknown>): Promise<string> {
  const number = term(String(input.number ?? ''));
  if (!number) return '의뢰번호를 주어야 합니다.';
  const { data: wo, error } = await ctx.service.from('dgflow_work_orders').select(WO_SELECT).eq('work_order_number', number).maybeSingle();
  if (error) return `읽지 못했습니다: ${error.message}`;
  if (!wo) return `의뢰번호 ${number} 작업의뢰서가 없습니다. find_work_orders 로 번호를 먼저 확인하세요.`;
  const head = wo as unknown as WoRow;
  const [items, logs] = await Promise.all([
    fetchAll<{ id: string; item_no: number | null; sort_order: number | null; product_name: string; width_mm: number; height_mm: number; quantity: number; produced_quantity: number | null }>(
      (a, b) => ctx.service.from('dgflow_work_order_items').select('id, item_no, sort_order, product_name, width_mm, height_mm, quantity, produced_quantity')
        .eq('work_order_id', head.id).order('sort_order').order('id').range(a, b)),
    fetchAll<{ production_date: string; quantity_completed: number }>(
      (a, b) => ctx.service.from('dgflow_production_logs').select('production_date, quantity_completed')
        .eq('work_order_id', head.id).order('production_date').order('id').range(a, b)),
  ]);
  const delivered = hasPermission(ctx.user, 'production:view') ? deliveredByItem((await loadDeliveries(ctx.service, [head.id])).logs) : null;
  const labels = workOrderLabels(head as unknown as WorkOrderLabelSource);
  const qty = items.reduce((s, i) => s + i.quantity, 0);
  const produced = items.reduce((s, i) => s + Math.min(i.produced_quantity ?? 0, i.quantity), 0);
  const byDate = new Map<string, number>();
  for (const l of logs) byDate.set(l.production_date, (byDate.get(l.production_date) ?? 0) + l.quantity_completed);
  const lines = [
    `작업의뢰서 ${head.work_order_number} | ${[labels.customer, labels.site].filter(Boolean).join(' · ') || '이름 없음'} | 의뢰일 ${head.request_date ?? '없음'} | 납기 ${head.delivery_date ?? '없음'} | ${STATUS[head.status] ?? head.status}`
      + `${isMesOrder(head.notes) ? ' | MES 생산실적으로 등록한 의뢰서(수량은 MES 바코드 기준, 납품 기록 없음)' : ''}`,
    `- 품목 ${items.length}개 · 의뢰 ${n(qty)}조 · 생산 ${n(produced)}조 · 남은 생산 ${n(qty - produced)}조`
      + `${delivered ? ` · 납품 ${n([...delivered.values()].reduce((s, v) => s + v, 0))}조` : ''}`,
    `- 생산한 날: ${byDate.size === 0 ? '없음' : [...byDate].map(([d, q]) => `${d} ${n(q)}조`).join(', ')}`,
    `- 품목${items.length > 60 ? ` (${items.length}개 중 60개)` : ''}:`,
  ];
  items.slice(0, 60).forEach((it, k) => {
    lines.push(`  - No.${itemNo(it, k)} | ${it.product_name} | ${it.width_mm}×${it.height_mm} | 의뢰 ${n(it.quantity)} · 생산 ${n(it.produced_quantity ?? 0)}${delivered ? ` · 납품 ${n(delivered.get(it.id) ?? 0)}` : ''}`);
  });
  return lines.join('\n');
}

/** 도구 하나를 돌려 결과 글을 준다 — 틀린 입력 · 오류도 글로 돌려줘 AI 가 다시 물을 수 있게 */
export async function runPrismTool(name: string, input: unknown, ctx: ToolContext): Promise<string> {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  try {
    switch (name) {
      case 'production_stats': return await productionStats(ctx, args);
      case 'delivery_stats': return await deliveryStats(ctx, args);
      case 'find_work_orders': return await findWorkOrders(ctx, args);
      case 'work_order_detail': return await workOrderDetail(ctx, args);
      default: return `모르는 도구입니다: ${name}`;
    }
  } catch (e) {
    console.error('[prism] 도구', name, e);
    return `읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
  }
}
