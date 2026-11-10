import type { SupabaseClient } from '@supabase/supabase-js';
import { hasPermission, type PermissionSubject } from '@/lib/auth/role-guard';
import { deriveStage, stalledDays, type PoStage, type StoredStage } from './stage';
import type { CheckResult } from './match';
import { SITE_SELECT, toWorkOrderSite, type WorkOrderSite } from '@/lib/work-order/site';
import { fetchAll, fetchAllIn } from '@/lib/supabase/fetch-all';

/** 서버 전용 — service role 클라이언트를 받아 발주 건을 읽고 쓴다 */

export type EventAction =
  | 'submitted' | 'downloaded' | 'checked' | 'assigned' | 'erp_opened' | 'erp_saved'
  | 'linked' | 'unlinked' | 'cancelled' | 'edited' | 'purged';

export async function logEvent(
  supabase: SupabaseClient, poId: string, userId: string | null, action: EventAction, detail: Record<string, unknown> = {},
) {
  await supabase.from('dgflow_purchase_order_events').insert({ purchase_order_id: poId, user_id: userId, action, detail });
}

/** 담당자로 지목받을 수 있는 사람 — 발주서 처리 권한이 있는 활성 사용자 */
export function canProcess(user: PermissionSubject): boolean {
  return hasPermission(user, 'order:process');
}

export async function listAssignees(supabase: SupabaseClient) {
  const { data } = await supabase
    .from('dgflow_users')
    .select('id, name, department, position, role, permissions')
    .eq('status', 'active')
    .eq('is_active', true)
    .order('name');
  return (data ?? [])
    .filter(u => canProcess(u))
    .map(u => ({ id: u.id as string, name: u.name as string, department: u.department as string | null, position: u.position as string | null }));
}

/** 접수번호 P{YYMMDD}-{NN} — 한국 날짜 기준, 그날 들어온 순서 */
export async function nextIntakeNumber(supabase: SupabaseClient): Promise<string> {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit' })
    .format(new Date()).replace(/-/g, '');
  const prefix = `P${ymd}-`;
  const { data } = await supabase
    .from('dgflow_purchase_orders')
    .select('intake_number')
    .like('intake_number', `${prefix}%`)
    .order('intake_number', { ascending: false })
    .limit(1);
  const last = data?.[0]?.intake_number as string | undefined;
  const n = last ? Number(last.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(2, '0')}`;
}

export interface PoRow {
  id: string;
  intake_number: string;
  customer_name: string | null;
  site_name: string | null;
  due_date: string | null;
  memo: string | null;
  created_by: string;
  assignee_id: string | null;
  stage: StoredStage;
  checked_at: string | null;
  checked_by: string | null;
  erp_saved_at: string | null;
  created_at: string;
}

export interface PoPackage {
  id: string;
  sheet_name: string;
  seq: number;
  label: string;
  rows: { location: string; width_mm: number; height_mm: number; quantity: number }[];
  total_quantity: number;
  work_order_id: string | null;
  linked_at: string | null;
  check_result: CheckResult | null;
  /** 이어진 작업의뢰서 — 어디서 만드는지(오창 · 외주 업체)까지 */
  work_order: { id: string; work_order_number: string; total: number; produced: number; site: WorkOrderSite } | null;
}

export interface PoSummary extends PoRow {
  creator_name: string;
  assignee_name: string | null;
  derived: PoStage;
  packages_total: number;
  packages_linked: number;
  stalled_days: number | null;
  produced: number;
  total: number;
  /** 이어진 작업의뢰서들의 생산 공장 — 목록에서 "오창공장 · 외주 ○○" 로 (2026-11-02) */
  sites: WorkOrderSite[];
  /** 이어진 작업의뢰서 id — 대시보드 '이번 달 완료' 가 이 의뢰서들의 생산 기록으로 끝난 달을 본다 */
  work_order_ids: string[];
  /** 마지막으로 작업의뢰서를 이은 시각 — 이미 다 만든 의뢰서를 이어서 '완료' 가 된 때를 알려고 */
  last_linked_at: string | null;
}

/** 작업의뢰서별 생산 공장 (오창 · 외주 업체와 담당자) */
async function workOrderSites(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, WorkOrderSite>();
  if (ids.length === 0) return map;
  // 이어진 의뢰서가 수백 장이면 `.in()` 한 번이 주소 길이 한도를 넘는다 — 묶음으로 나눠 읽는다 (2026-11-10 점검)
  const data = await fetchAllIn<{ id: string; production_site?: string | null; outsource_partner?: unknown }>(ids, (chunk, a, b) => supabase
    .from('dgflow_work_orders').select(`id, ${SITE_SELECT}`).in('id', chunk).order('id').range(a, b));
  for (const w of data) map.set(w.id, toWorkOrderSite(w));
  return map;
}

async function userNames(supabase: SupabaseClient, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (unique.length === 0) return new Map<string, string>();
  const { data } = await supabase.from('dgflow_users').select('id, name').in('id', unique);
  return new Map((data ?? []).map(u => [u.id as string, u.name as string]));
}

/** 작업의뢰서별 총 수량 · 생산 수량 */
async function workOrderProgress(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, { total: number; produced: number }>();
  if (ids.length === 0) return map;
  // 품목이 1,000줄을 넘으면 잘려 진행률이 틀리고, 덜 읽힌 의뢰서가 '끝남' 으로 보여 정리(cleanup)가
  // 진행 중인 발주서 원본까지 지울 수 있었다 — 끝까지 나눠 읽는다 (2026-11-10 전체 점검)
  const data = await fetchAllIn<{ work_order_id: string; quantity: number | null; produced_quantity: number | null }>(ids, (chunk, a, b) => supabase
    .from('dgflow_work_order_items')
    .select('work_order_id, quantity, produced_quantity')
    .in('work_order_id', chunk)
    .order('id')
    .range(a, b));
  for (const r of data) {
    const p = map.get(r.work_order_id) ?? { total: 0, produced: 0 };
    p.total += r.quantity ?? 0;
    p.produced += Math.min(r.produced_quantity ?? 0, r.quantity ?? 0);
    map.set(r.work_order_id, p);
  }
  return map;
}

const PO_COLUMNS =
  'id, intake_number, customer_name, site_name, due_date, memo, created_by, assignee_id, stage, checked_at, checked_by, erp_saved_at, created_at';

/**
 * 목록 · 대시보드용 — 단계를 계산해 붙인다.
 *
 * **다 읽지 못하면 던진다** (2026-11-10 점검). 예전에는 포장을 `.in('purchase_order_id', 300개)` 한 번으로 읽고
 * 오류를 버려서, 주소 길이 한도에 걸리면 모든 건이 틀린 단계로 보였고, 1,000줄을 넘으면 잘려 포장 일부만 읽힌 건이
 * '완료' 로 계산될 수 있었다 — 그러면 '끝난 건 정리' 가 진행 중인 발주서 원본을 지운다. 틀린 목록보다 오류가 낫다.
 * `limit` 은 최근 몇 건까지 볼지 (1,000 을 넘으면 나눠 읽는다. 끝없이 = Infinity).
 */
export async function listPurchaseOrders(supabase: SupabaseClient, opts: { limit?: number } = {}): Promise<PoSummary[]> {
  const limit = opts.limit ?? 300;
  const rows = (await fetchAll<PoRow>((a, b) => a >= limit
    ? Promise.resolve({ data: [], error: null })
    : supabase
      .from('dgflow_purchase_orders')
      .select(PO_COLUMNS)
      .order('created_at', { ascending: false })
      .order('id')
      .range(a, Math.min(b, limit - 1)))).slice(0, limit);
  if (rows.length === 0) return [];

  const pkgs = await fetchAllIn<{ purchase_order_id: string; work_order_id: string | null; linked_at: string | null }>(
    rows.map(r => r.id),
    (chunk, a, b) => supabase
      .from('dgflow_purchase_order_packages')
      .select('purchase_order_id, work_order_id, linked_at')
      .in('purchase_order_id', chunk)
      .order('id')
      .range(a, b),
  );
  const byPo = new Map<string, typeof pkgs>();
  for (const p of pkgs) {
    const list = byPo.get(p.purchase_order_id);
    if (list) list.push(p); else byPo.set(p.purchase_order_id, [p]);
  }
  const linkedIds = [...new Set(pkgs.map(p => p.work_order_id).filter((v): v is string => !!v))];
  const [progress, sites] = await Promise.all([workOrderProgress(supabase, linkedIds), workOrderSites(supabase, linkedIds)]);
  const names = await userNames(supabase, rows.flatMap(r => [r.created_by, r.assignee_id]));

  return rows.map(r => {
    const own = byPo.get(r.id) ?? [];
    const mine = own.map(p => ({
      work_order_id: p.work_order_id,
      ...(p.work_order_id ? progress.get(p.work_order_id) : {}),
    }));
    const derived = deriveStage(r.stage, mine);
    const workOrderIds = mine.map(p => p.work_order_id).filter((v): v is string => !!v);
    return {
      ...r,
      creator_name: names.get(r.created_by) ?? '-',
      assignee_name: r.assignee_id ? names.get(r.assignee_id) ?? '-' : null,
      derived,
      packages_total: mine.length,
      packages_linked: workOrderIds.length,
      stalled_days: stalledDays({ ...r, stage: derived }),
      produced: mine.reduce((n, p) => n + (p.produced ?? 0), 0),
      total: mine.reduce((n, p) => n + (p.total ?? 0), 0),
      sites: uniqueSites(mine.map(p => (p.work_order_id ? sites.get(p.work_order_id) : undefined))),
      work_order_ids: workOrderIds,
      last_linked_at: latest(own.map(p => p.linked_at)),
    };
  });
}

/** ISO 시각 중 가장 늦은 것 (없으면 null) */
function latest(list: (string | null)[]): string | null {
  let best: string | null = null;
  for (const t of list) if (t && (!best || new Date(t).getTime() > new Date(best).getTime())) best = t;
  return best;
}

/** 같은 공장(같은 외주 업체)은 한 번만 */
function uniqueSites(list: (WorkOrderSite | undefined)[]): WorkOrderSite[] {
  const seen = new Map<string, WorkOrderSite>();
  for (const s of list) if (s) seen.set(s.site === 'ochang' ? 'ochang' : `o:${s.partner?.name ?? ''}`, s);
  return [...seen.values()];
}

export interface PoFile {
  id: string;
  kind: 'order' | 'erp' | 'spec';
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_prefix: string;
  chunk_count: number;
  sheet_name: string | null;
  created_at: string;
  purged_at: string | null;
}

export interface PoEvent {
  id: string;
  action: EventAction;
  detail: Record<string, unknown>;
  created_at: string;
  user_name: string;
}

export interface PoDetail extends PoSummary {
  checked_by_name: string | null;
  files: PoFile[];
  packages: PoPackage[];
  events: PoEvent[];
}

export async function loadPurchaseOrder(supabase: SupabaseClient, id: string): Promise<PoDetail | null> {
  const { data: po } = await supabase.from('dgflow_purchase_orders').select(PO_COLUMNS).eq('id', id).maybeSingle();
  if (!po) return null;
  const row = po as PoRow;

  const [filesRes, pkgsRes, eventsRes] = await Promise.all([
    supabase.from('dgflow_purchase_order_files').select('*').eq('purchase_order_id', id).order('created_at'),
    supabase.from('dgflow_purchase_order_packages').select('*').eq('purchase_order_id', id).order('sheet_name').order('seq'),
    supabase.from('dgflow_purchase_order_events').select('*').eq('purchase_order_id', id).order('created_at', { ascending: false }),
  ]);
  // 못 읽은 것을 빈 목록으로 두면 단계 · 파일이 틀리게 보인다 — 오류로 알린다 (2026-11-10 점검)
  const failed = filesRes.error ?? pkgsRes.error ?? eventsRes.error;
  if (failed) throw new Error(`발주 건을 읽지 못했습니다: ${failed.message}`);
  const files = filesRes.data;
  const pkgs = pkgsRes.data;
  const events = eventsRes.data;

  const woIds = (pkgs ?? []).map(p => p.work_order_id).filter(Boolean) as string[];
  const progress = await workOrderProgress(supabase, woIds);
  const wosRes = woIds.length
    ? await supabase.from('dgflow_work_orders').select(`id, work_order_number, ${SITE_SELECT}`).in('id', woIds)
    : { data: [], error: null };
  if (wosRes.error) throw new Error(`작업의뢰서를 읽지 못했습니다: ${wosRes.error.message}`);
  const wos = wosRes.data;
  const woNumber = new Map((wos ?? []).map(w => [w.id as string, w.work_order_number as string]));
  const woSite = new Map((wos ?? []).map(w => [w.id as string, toWorkOrderSite(w)]));

  const names = await userNames(supabase, [
    row.created_by, row.assignee_id, row.checked_by, ...(events ?? []).map(e => e.user_id),
  ]);

  const packages: PoPackage[] = (pkgs ?? []).map(p => ({
    ...p,
    work_order: p.work_order_id
      ? {
          id: p.work_order_id, work_order_number: woNumber.get(p.work_order_id) ?? '?',
          ...(progress.get(p.work_order_id) ?? { total: 0, produced: 0 }),
          site: woSite.get(p.work_order_id) ?? { site: 'ochang' as const, partner: null },
        }
      : null,
  }));
  const derived = deriveStage(row.stage, packages.map(p => ({
    work_order_id: p.work_order_id, total: p.work_order?.total, produced: p.work_order?.produced,
  })));

  return {
    ...row,
    creator_name: names.get(row.created_by) ?? '-',
    assignee_name: row.assignee_id ? names.get(row.assignee_id) ?? '-' : null,
    checked_by_name: row.checked_by ? names.get(row.checked_by) ?? '-' : null,
    derived,
    packages_total: packages.length,
    packages_linked: packages.filter(p => p.work_order_id).length,
    stalled_days: stalledDays({ ...row, stage: derived }),
    produced: packages.reduce((n, p) => n + (p.work_order?.produced ?? 0), 0),
    total: packages.reduce((n, p) => n + (p.work_order?.total ?? 0), 0),
    sites: uniqueSites(packages.map(p => p.work_order?.site)),
    work_order_ids: woIds,
    last_linked_at: latest(packages.map(p => p.linked_at)),
    files: (files ?? []) as PoFile[],
    packages,
    events: (events ?? []).map(e => ({ ...e, user_name: e.user_id ? names.get(e.user_id) ?? '-' : '시스템' })) as PoEvent[],
  };
}
