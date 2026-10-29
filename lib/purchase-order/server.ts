import type { SupabaseClient } from '@supabase/supabase-js';
import { hasPermission, type PermissionSubject } from '@/lib/auth/role-guard';
import { deriveStage, stalledDays, type PoStage, type StoredStage } from './stage';
import type { CheckResult } from './match';

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
  work_order: { id: string; work_order_number: string; total: number; produced: number } | null;
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
  const { data } = await supabase
    .from('dgflow_work_order_items')
    .select('work_order_id, quantity, produced_quantity')
    .in('work_order_id', ids);
  for (const r of data ?? []) {
    const p = map.get(r.work_order_id) ?? { total: 0, produced: 0 };
    p.total += r.quantity ?? 0;
    p.produced += Math.min(r.produced_quantity ?? 0, r.quantity ?? 0);
    map.set(r.work_order_id, p);
  }
  return map;
}

const PO_COLUMNS =
  'id, intake_number, customer_name, site_name, due_date, memo, created_by, assignee_id, stage, checked_at, checked_by, erp_saved_at, created_at';

/** 목록 · 대시보드용 — 단계를 계산해 붙인다 */
export async function listPurchaseOrders(supabase: SupabaseClient, opts: { limit?: number } = {}): Promise<PoSummary[]> {
  const { data: pos } = await supabase
    .from('dgflow_purchase_orders')
    .select(PO_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 300);
  const rows = (pos ?? []) as PoRow[];
  if (rows.length === 0) return [];

  const { data: pkgs } = await supabase
    .from('dgflow_purchase_order_packages')
    .select('purchase_order_id, work_order_id')
    .in('purchase_order_id', rows.map(r => r.id));
  const progress = await workOrderProgress(supabase, (pkgs ?? []).map(p => p.work_order_id).filter(Boolean));
  const names = await userNames(supabase, rows.flatMap(r => [r.created_by, r.assignee_id]));

  return rows.map(r => {
    const mine = (pkgs ?? []).filter(p => p.purchase_order_id === r.id).map(p => ({
      work_order_id: p.work_order_id as string | null,
      ...(p.work_order_id ? progress.get(p.work_order_id) : {}),
    }));
    const derived = deriveStage(r.stage, mine);
    return {
      ...r,
      creator_name: names.get(r.created_by) ?? '-',
      assignee_name: r.assignee_id ? names.get(r.assignee_id) ?? '-' : null,
      derived,
      packages_total: mine.length,
      packages_linked: mine.filter(p => p.work_order_id).length,
      stalled_days: stalledDays({ ...r, stage: derived }),
      produced: mine.reduce((n, p) => n + (p.produced ?? 0), 0),
      total: mine.reduce((n, p) => n + (p.total ?? 0), 0),
    };
  });
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

  const [{ data: files }, { data: pkgs }, { data: events }] = await Promise.all([
    supabase.from('dgflow_purchase_order_files').select('*').eq('purchase_order_id', id).order('created_at'),
    supabase.from('dgflow_purchase_order_packages').select('*').eq('purchase_order_id', id).order('sheet_name').order('seq'),
    supabase.from('dgflow_purchase_order_events').select('*').eq('purchase_order_id', id).order('created_at', { ascending: false }),
  ]);

  const woIds = (pkgs ?? []).map(p => p.work_order_id).filter(Boolean) as string[];
  const progress = await workOrderProgress(supabase, woIds);
  const { data: wos } = woIds.length
    ? await supabase.from('dgflow_work_orders').select('id, work_order_number').in('id', woIds)
    : { data: [] };
  const woNumber = new Map((wos ?? []).map(w => [w.id as string, w.work_order_number as string]));

  const names = await userNames(supabase, [
    row.created_by, row.assignee_id, row.checked_by, ...(events ?? []).map(e => e.user_id),
  ]);

  const packages: PoPackage[] = (pkgs ?? []).map(p => ({
    ...p,
    work_order: p.work_order_id
      ? { id: p.work_order_id, work_order_number: woNumber.get(p.work_order_id) ?? '?', ...(progress.get(p.work_order_id) ?? { total: 0, produced: 0 }) }
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
    files: (files ?? []) as PoFile[],
    packages,
    events: (events ?? []).map(e => ({ ...e, user_name: e.user_id ? names.get(e.user_id) ?? '-' : '시스템' })) as PoEvent[],
  };
}
