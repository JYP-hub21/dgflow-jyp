import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listPurchaseOrders } from '@/lib/purchase-order/server';
import { cleanupPlan, pickPurgeable, type CleanupFileRow, type CleanupPoRow } from '@/lib/purchase-order/cleanup';

/**
 * 2026-11-10 점검 — 발주 건 목록이 포장 · 품목을 끝까지 읽는지, 못 읽으면 던지는지.
 * PostgREST 처럼 한 번에 1,000줄만 주고, `.in()` 값이 많으면 주소 길이 오류를 내는 가짜 DB 로 시험한다.
 */
type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, opts: { maxIn?: number; failOn?: string } = {}) {
  const calls: { table: string; inSize: number }[] = [];
  const client = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const orders: [string, boolean][] = [];
      let range: [number, number] | null = null;
      let limit = Infinity;
      let error: string | null = opts.failOn === table ? '읽기 실패' : null;
      let inSize = 0;
      const b = {
        select: () => b,
        in(col: string, vals: unknown[]) {
          inSize = vals.length;
          if (opts.maxIn && vals.length > opts.maxIn) error = 'URI too long';
          const set = new Set(vals);
          filters.push(r => set.has(r[col]));
          return b;
        },
        eq(col: string, v: unknown) { filters.push(r => r[col] === v); return b; },
        order(col: string, o?: { ascending?: boolean }) { orders.push([col, o?.ascending !== false]); return b; },
        range(a: number, z: number) { range = [a, z]; return b; },
        limit(n: number) { limit = n; return b; },
        then(res: (v: { data: Row[] | null; error: { message: string } | null }) => unknown, rej?: (e: unknown) => unknown) {
          calls.push({ table, inSize });
          if (error) return Promise.resolve({ data: null, error: { message: error } }).then(res, rej);
          let rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
          rows = [...rows].sort((x, y) => {
            for (const [c, asc] of orders) {
              const d = String(x[c]).localeCompare(String(y[c]));
              if (d) return asc ? d : -d;
            }
            return 0;
          });
          const [a, z] = range ?? [0, Infinity];
          rows = rows.slice(a, Math.min(z + 1, a + 1000)).slice(0, limit); // 한 번에 최대 1,000줄
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return b;
    },
  };
  return { db: client as unknown as SupabaseClient, calls };
}

const pad = (n: number) => String(n).padStart(4, '0');
const po = (id: string, created_at: string): Row => ({
  id, intake_number: `P${id}`, customer_name: null, site_name: `현장 ${id}`, due_date: null, memo: null,
  created_by: 'u1', assignee_id: 'u1', stage: 'erp_ready', checked_at: null, checked_by: null, erp_saved_at: null, created_at,
});

describe('발주 건 목록 — 끝까지 읽기 (2026-11-10 점검)', () => {
  it('포장 · 품목이 1,000줄을 넘어도 다 읽어, 덜 이어진 건을 완료로 보지 않는다', async () => {
    // 포장 1,100개 — 앞 1,099개는 다 만든 의뢰서가 이어졌고, 맨 끝 하나는 아직 안 이어졌다
    const packages: Row[] = Array.from({ length: 1100 }, (_, i) => ({
      id: `pkg-${pad(i)}`, purchase_order_id: 'A', work_order_id: i < 1099 ? `wo-${pad(i)}` : null, linked_at: null,
    }));
    const items: Row[] = Array.from({ length: 1099 }, (_, i) => ({
      id: `it-${pad(i)}`, work_order_id: `wo-${pad(i)}`, quantity: 5, produced_quantity: 5,
    }));
    const workOrders: Row[] = Array.from({ length: 1099 }, (_, i) => ({ id: `wo-${pad(i)}`, production_site: 'ochang', outsource_partner: null }));
    const { db } = fakeDb({
      dgflow_purchase_orders: [po('A', '2026-11-01T00:00:00Z')],
      dgflow_purchase_order_packages: packages,
      dgflow_work_order_items: items,
      dgflow_work_orders: workOrders,
      dgflow_users: [{ id: 'u1', name: '담당' }],
    });
    const [a] = await listPurchaseOrders(db);
    expect(a.packages_total).toBe(1100);
    expect(a.packages_linked).toBe(1099);
    expect(a.derived).toBe('linking'); // 예전에는 1,000개만 읽혀 'done' 이 될 수 있었다
    expect(a.work_order_ids).toHaveLength(1099);
  });

  it('발주 건 300개도 `.in()` 을 묶음으로 나눠 읽는다 — 주소 길이 오류가 없다', async () => {
    const pos = Array.from({ length: 300 }, (_, i) => po(`p${pad(i)}`, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`));
    const { db, calls } = fakeDb({
      dgflow_purchase_orders: pos,
      dgflow_purchase_order_packages: [{ id: 'k1', purchase_order_id: 'p0007', work_order_id: 'w1', linked_at: '2026-11-03T01:00:00Z' }],
      dgflow_work_order_items: [{ id: 'i1', work_order_id: 'w1', quantity: 3, produced_quantity: 3 }],
      dgflow_work_orders: [{ id: 'w1', production_site: 'ochang', outsource_partner: null }],
      dgflow_users: [{ id: 'u1', name: '담당' }],
    }, { maxIn: 200 });
    const list = await listPurchaseOrders(db);
    expect(list).toHaveLength(300);
    const hit = list.find(p => p.id === 'p0007')!;
    expect(hit.derived).toBe('done');
    expect(hit.last_linked_at).toBe('2026-11-03T01:00:00Z');
    expect(Math.max(...calls.filter(c => c.table === 'dgflow_purchase_order_packages').map(c => c.inSize))).toBeLessThanOrEqual(150);
  });

  it('포장을 못 읽으면 틀린 단계 대신 던진다', async () => {
    const { db } = fakeDb({ dgflow_purchase_orders: [po('A', '2026-11-01T00:00:00Z')] }, { failOn: 'dgflow_purchase_order_packages' });
    await expect(listPurchaseOrders(db)).rejects.toThrow('읽기 실패');
  });

  it('limit 이 1,000 을 넘으면 나눠 읽는다', async () => {
    const pos = Array.from({ length: 1500 }, (_, i) => po(`p${pad(i)}`, `2026-10-01T00:00:${String(i % 60).padStart(2, '0')}Z`));
    const { db } = fakeDb({ dgflow_purchase_orders: pos, dgflow_users: [] });
    expect(await listPurchaseOrders(db, { limit: Infinity })).toHaveLength(1500);
    expect(await listPurchaseOrders(db, { limit: 1000 })).toHaveLength(1000);
    expect(await listPurchaseOrders(db)).toHaveLength(300);
  });
});

describe('끝난 건 정리 — 확인 창에 건마다, 고른 것만 (2026-11-10 점검)', () => {
  const pos: CleanupPoRow[] = [
    { id: 'a', intake_number: 'P261101-01', site_name: '현장A', customer_name: '우미', derived: 'done', packages_linked: 2 },
    { id: 'b', intake_number: 'P261101-02', site_name: null, customer_name: 'KCC', derived: 'cancelled', packages_linked: 0 },
    { id: 'c', intake_number: 'P261102-01', site_name: '현장C', customer_name: null, derived: 'producing', packages_linked: 1 },
    { id: 'd', intake_number: 'P261102-02', site_name: '현장D', customer_name: null, derived: 'done', packages_linked: 1 },
  ];
  const f = (id: string, po: string, kind: string, size: number, purged: string | null = null): CleanupFileRow => ({
    id, purchase_order_id: po, kind, file_name: `${id}.xlsx`, size_bytes: String(size), storage_prefix: `${po}/${id}`, chunk_count: 1, purged_at: purged,
  });
  const files = [
    f('a1', 'a', 'order', 100), f('a2', 'a', 'erp', 10), f('a3', 'a', 'spec', 5),
    f('b1', 'b', 'order', 200),
    f('c1', 'c', 'order', 400),
    f('d1', 'd', 'order', 50, '2026-11-05T00:00:00Z'), // 이미 지운 파일뿐 → 목록에 안 나온다
  ];

  it('끝난 건(완료 · 취소)만, 건마다 원본 이름 · 만든 파일 수 · 크기', () => {
    const plan = cleanupPlan(pos, files);
    expect(plan.used).toBe(715);
    expect(plan.orders.map(o => o.intake_number)).toEqual(['P261101-01', 'P261101-02']);
    expect(plan.orders[0]).toMatchObject({ name: '현장A · 우미', state: 'done', work_orders: 2, order_files: ['a1.xlsx'], made_files: 2, files: 3, bytes: 115 });
    expect(plan.orders[1]).toMatchObject({ name: 'KCC', state: 'cancelled', order_files: ['b1.xlsx'], made_files: 0, bytes: 200 });
    expect(plan.purgeable.map(x => x.id)).toEqual(['a1', 'a2', 'a3', 'b1']);
  });

  it('고른 건의 파일만 지운다 — 진행 중인 건은 골라 보내도 빠진다', () => {
    const plan = cleanupPlan(pos, files);
    expect(pickPurgeable(plan, ['b']).map(x => x.id)).toEqual(['b1']);
    expect(pickPurgeable(plan, ['c', 'a']).map(x => x.id)).toEqual(['a1', 'a2', 'a3']);
    expect(pickPurgeable(plan, [])).toEqual([]);
  });
});
