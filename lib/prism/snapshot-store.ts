import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { canViewAny, hasPermission, ORDER_ANY, type PermissionSubject } from '@/lib/auth/role-guard';
import { listPurchaseOrders } from '@/lib/purchase-order/server';
import { kstDateOf } from '@/lib/kst-date';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import { doneInMonth, NO_PROGRESS, progressByWorkOrder } from '@/lib/dashboard/work-orders';
import { loadDeliveries, loadDeliveriesBetween } from '@/lib/production/delivery-store';
import { deliveredByItem, deliveryTodo } from '@/lib/production/delivery';
import { intakeByWeek, type Snapshot } from '@/lib/prism/snapshot';
import type { PoStage } from '@/lib/purchase-order/stage';

/**
 * DG 프리즘 대화용 현황을 DB 에서 센다 — 대시보드(app/(authenticated)/dashboard) · 납품 화면과 같은 기준.
 * 하나를 못 읽어도 나머지는 준다(그 칸만 null → "읽지 못했습니다").
 * 권한: 대시보드는 누구나 보므로 발주 단계 건수 · 작업의뢰서 · 생산은 누구에게나,
 * 발주 건별 이름은 발주서 권한이 있을 때, 납품은 생산 조회 권한이 있을 때만 준다.
 */

const kst = (offsetDays = 0) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

interface OpenWorkOrderRow {
  id: string;
  customer_label: string | null;
  site_label: string | null;
  /** 주문에서 온 의뢰서의 거래처 · 현장 (workOrderLabels 가 읽는다) */
  order: unknown;
  work_order_number: string;
  delivery_date: string | null;
  items: { id: string; quantity: number | null; produced_quantity: number | null }[] | null;
}

export async function loadSnapshot(user: PermissionSubject): Promise<Snapshot> {
  const supabase = await createServerSupabaseClient();
  const service = createServiceRoleClient();
  const today = kst(0);
  const from = kst(-13);
  const monthStart = `${today.slice(0, 8)}01`;
  const canDelivery = hasPermission(user, 'production:view');

  const [pos, openOrders, recentLogs, monthLogs] = await Promise.all([
    listPurchaseOrders(service).catch((e: unknown) => { console.error('[prism] 발주서', e); return null; }),
    fetchAll<OpenWorkOrderRow>((a, b) => supabase.from('dgflow_work_orders')
      .select(`
        id, work_order_number, delivery_date, customer_label, site_label,
        order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name)),
        items:dgflow_work_order_items(id, quantity, produced_quantity)
      `)
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: false })
      .order('id')
      .range(a, b)).catch((e: unknown) => { console.error('[prism] 작업의뢰서', e); return null; }),
    fetchAll<{ production_date: string; quantity_completed: number; area_m2: number | null }>((a, b) => supabase
      .from('dgflow_production_logs').select('production_date, quantity_completed, area_m2')
      .gte('production_date', from).lte('production_date', today).order('id').range(a, b))
      .catch((e: unknown) => { console.error('[prism] 생산', e); return null; }),
    fetchAll<{ quantity_completed: number; area_m2: number | null; work_order_id: string }>((a, b) => supabase
      .from('dgflow_production_logs').select('quantity_completed, area_m2, work_order_id')
      .gte('production_date', monthStart).order('id').range(a, b))
      .catch((e: unknown) => { console.error('[prism] 이번 달 생산', e); return null; }),
  ]);

  const snap: Snapshot = { today, po: null, workOrders: null, production: null, delivery: null };

  // ── 발주 건
  if (pos) {
    const live = pos.filter(p => p.derived !== 'cancelled');
    const producedThisMonth = new Set((monthLogs ?? []).map(l => l.work_order_id));
    const counts: Partial<Record<PoStage, number>> = {};
    for (const p of live) if (p.derived !== 'done') counts[p.derived] = (counts[p.derived] ?? 0) + 1;
    snap.po = {
      counts,
      doneThisMonth: live.filter(p => p.derived === 'done' && doneInMonth(p, monthStart, producedThisMonth)).length,
      intakeWeeks: intakeByWeek(pos.map(p => kstDateOf(p.created_at) ?? p.created_at.slice(0, 10)), today),
      open: canViewAny(user, ORDER_ANY)
        ? live.filter(p => p.derived !== 'done').map(p => ({
          number: p.intake_number,
          customer: p.customer_name,
          site: p.site_name,
          stage: p.derived,
          created: kstDateOf(p.created_at) ?? p.created_at.slice(0, 10),
          assignee: p.assignee_name,
          stalledDays: p.stalled_days,
        }))
        : null,
    };
  }

  // ── 작업의뢰서 (생산이 남은 것)
  if (openOrders) {
    const items = openOrders.flatMap(wo => (wo.items ?? []).map(it => ({ work_order_id: wo.id, quantity: it.quantity, produced_quantity: it.produced_quantity })));
    const progress = progressByWorkOrder(items);
    const rows = openOrders.map(wo => ({ wo, labels: workOrderLabels(wo as WorkOrderLabelSource), p: progress.get(wo.id) ?? NO_PROGRESS }));
    const active = rows.filter(r => r.p.remaining > 0);
    snap.workOrders = {
      active: active.length,
      remaining: active.reduce((s, r) => s + r.p.remaining, 0),
      deliveryOnly: rows.filter(r => r.p.produced_all).length,
      byDue: [...active]
        .sort((a, b) => (a.wo.delivery_date ?? '9999').localeCompare(b.wo.delivery_date ?? '9999') || b.p.percent - a.p.percent)
        .map(r => ({
          number: r.wo.work_order_number, customer: r.labels.customer, site: r.labels.site,
          due: r.wo.delivery_date, percent: r.p.percent, remaining: r.p.remaining,
        })),
    };
  }

  // ── 생산
  if (recentLogs && monthLogs) {
    const days = Array.from({ length: 14 }, (_, i) => ({ date: kst(-13 + i), qty: 0, area: 0 }));
    const byDate = new Map(days.map(d => [d.date, d]));
    for (const l of recentLogs) {
      const d = byDate.get(l.production_date);
      if (!d) continue;
      d.qty += l.quantity_completed;
      d.area += Number(l.area_m2 || 0);
    }
    snap.production = {
      days,
      monthQty: monthLogs.reduce((s, l) => s + l.quantity_completed, 0),
      monthArea: monthLogs.reduce((s, l) => s + Number(l.area_m2 || 0), 0),
    };
  }

  // ── 납품 (생산 조회 권한이 있을 때만)
  if (canDelivery && openOrders) {
    try {
      const [month, open] = await Promise.all([
        loadDeliveriesBetween(service, monthStart, today),
        loadDeliveries(service, openOrders.map(wo => wo.id)),
      ]);
      const delivered = deliveredByItem(open.logs);
      const ready = openOrders.map(wo => ({
        wo, labels: workOrderLabels(wo as WorkOrderLabelSource),
        todo: deliveryTodo((wo.items ?? []).map(it => ({ id: it.id, quantity: it.quantity ?? 0, produced_quantity: it.produced_quantity ?? 0 })), delivered),
      })).filter(r => r.todo.ready > 0)
        .sort((a, b) => b.todo.ready - a.todo.ready);
      snap.delivery = {
        monthQty: month.logs.reduce((s, l) => s + l.quantity, 0),
        monthArea: month.logs.reduce((s, l) => s + Number(l.area_m2 || 0), 0),
        todayQty: month.logs.filter(l => l.delivery_date === today).reduce((s, l) => s + l.quantity, 0),
        readyQty: ready.reduce((s, r) => s + r.todo.ready, 0),
        readyOrders: ready.map(r => ({
          number: r.wo.work_order_number, customer: r.labels.customer, site: r.labels.site, due: r.wo.delivery_date, ready: r.todo.ready,
        })),
      };
    } catch (e) {
      console.error('[prism] 납품', e);
    }
  }
  return snap;
}
