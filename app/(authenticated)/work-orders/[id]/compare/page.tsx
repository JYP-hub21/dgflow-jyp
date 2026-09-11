import { createServiceRoleClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight } from 'lucide-react';

/**
 * 원본 발주의뢰서 ↔ 작업의뢰서 나란히 비교.
 *
 * 왼쪽은 고객·현장에서 온 그대로의 발주 품목, 오른쪽은 규격별로 묶고
 * 담당자가 품명을 적어 만든 작업의뢰서. 어느 발주 줄이 어느 작업의뢰서 줄로
 * 갔는지, 품명이 어떻게 바뀌었는지를 한 화면에서 대조한다.
 */
export default async function WorkOrderComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceRoleClient();

  const { data: workOrder } = await supabase
    .from('dgflow_work_orders')
    .select(`
      id, work_order_number, request_date, delivery_date, status, source,
      customer_name, site_name, order_id,
      items:dgflow_work_order_items(*),
      order:dgflow_orders(
        id, order_number, order_date, delivery_date,
        customer:dgflow_customers(name, short_name),
        site:dgflow_sites(site_name),
        items:dgflow_order_items(*)
      )
    `)
    .eq('id', id)
    .single();

  if (!workOrder) notFound();

  type WoItem = {
    id: string; product_name: string; source_product_name: string | null;
    location_summary: string | null; source_item_count: number | null;
    width_mm: number; height_mm: number; quantity: number; sort_order: number;
  };
  type OrderItem = {
    id: string; product_name: string; width_mm: number; height_mm: number; quantity: number;
    location_dong: string | null; location_line: string | null; location_floor: string | null;
    location_room: string | null; location_type: string | null; location_window_type: string | null;
    sort_order: number;
  };

  const order = workOrder.order as unknown as {
    id: string; order_number: string; order_date: string;
    customer: { name: string; short_name: string } | null;
    site: { site_name: string } | null;
    items: OrderItem[];
  } | null;

  const woItems = ((workOrder.items || []) as WoItem[]).sort((a, b) => a.sort_order - b.sort_order);
  const orderItems = (order?.items || []).slice().sort((a, b) => a.sort_order - b.sort_order);

  // 발주 품목이 어느 작업의뢰서 줄에 들어갔는지 — 원본품명 + 규격으로 짝짓는다
  const groupOf = new Map<string, number>();
  woItems.forEach((w, idx) => {
    const key = `${w.source_product_name ?? w.product_name}|${w.width_mm}|${w.height_mm}`;
    groupOf.set(key, idx);
  });
  const indexOfOrderItem = (it: OrderItem) =>
    groupOf.get(`${it.product_name}|${it.width_mm}|${it.height_mm}`);

  // 묶음마다 다른 색 — 왼쪽 줄과 오른쪽 줄을 눈으로 잇기 위한 표시
  const HUES = [
    'border-l-blue-400', 'border-l-emerald-400', 'border-l-amber-400',
    'border-l-purple-400', 'border-l-rose-400', 'border-l-cyan-400',
    'border-l-lime-500', 'border-l-orange-400',
  ];
  const hue = (i: number | undefined) => (i === undefined ? 'border-l-gray-200' : HUES[i % HUES.length]);

  const sumQty = (n: number, q: number) => n + q;
  const orderQty = orderItems.reduce((s, i) => sumQty(s, i.quantity), 0);
  const woQty = woItems.reduce((s, i) => sumQty(s, i.quantity), 0);
  const renamed = woItems.filter(w => w.source_product_name && w.source_product_name !== w.product_name).length;
  const qtyMatches = orderQty === woQty;

  const locationOf = (it: OrderItem) =>
    [it.location_dong, it.location_line, it.location_floor, it.location_room, it.location_type, it.location_window_type]
      .filter(Boolean).join(' ') || '-';

  return (
    <div className="space-y-6 p-8">
      <div>
        <Link href={`/work-orders/${id}`} className="mb-2 inline-flex items-center text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="mr-1 h-4 w-4" />작업의뢰서로
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">원본 대조</h1>
        <p className="mt-1 text-sm text-gray-600">
          {order?.order_number ? `발주 ${order.order_number}` : '발주서 없음(엑셀 업로드)'} · 의뢰번호 {workOrder.work_order_number} ·
          {' '}{order?.customer?.short_name || workOrder.customer_name || '-'} · {order?.site?.site_name || workOrder.site_name || '-'}
        </p>
      </div>

      {/* 요약 */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-lg border bg-white px-4 py-3">
          <div className="text-xs text-gray-500">품목 줄 수</div>
          <div className="text-sm font-semibold text-gray-900 tabular-nums">
            {orderItems.length} <span className="font-normal text-gray-400">→</span> {woItems.length}
          </div>
        </div>
        <div className="rounded-lg border bg-white px-4 py-3">
          <div className="text-xs text-gray-500">총 수량</div>
          <div className="text-sm font-semibold tabular-nums">
            <span className={qtyMatches ? 'text-gray-900' : 'text-red-600'}>
              {orderQty.toLocaleString()} <span className="font-normal text-gray-400">→</span> {woQty.toLocaleString()}매
            </span>
          </div>
        </div>
        <div className="rounded-lg border bg-white px-4 py-3">
          <div className="text-xs text-gray-500">담당자가 고친 품명</div>
          <div className="text-sm font-semibold text-gray-900 tabular-nums">{renamed}줄</div>
        </div>
        <div className={`rounded-lg border px-4 py-3 ${qtyMatches ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
          <div className="text-xs text-gray-500">수량 대조</div>
          <div className={`text-sm font-semibold ${qtyMatches ? 'text-emerald-700' : 'text-red-700'}`}>
            {qtyMatches ? '일치' : '불일치 — 확인 필요'}
          </div>
        </div>
      </div>

      {/* 듀얼 화면 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 왼쪽: 원본 발주의뢰서 */}
        <section className="rounded-lg border bg-white">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">발주의뢰서 (원본)</h2>
            <span className="text-xs text-gray-500">{orderItems.length}줄 · 받은 그대로</span>
          </header>
          <div className="max-h-[70vh] overflow-auto">
            {orderItems.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-gray-500">
                주문서 없이 엑셀로 올린 작업의뢰서라 원본이 없습니다.
              </p>
            ) : (
              <ul className="divide-y">
                {orderItems.map(it => {
                  const gi = indexOfOrderItem(it);
                  return (
                    <li key={it.id} className={`border-l-4 px-4 py-2.5 ${hue(gi)}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-gray-900">{it.product_name}</div>
                          <div className="mt-0.5 text-xs text-gray-500">{locationOf(it)}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-xs text-gray-600 tabular-nums">{it.width_mm} × {it.height_mm}</div>
                          <div className="text-sm font-medium text-gray-900 tabular-nums">{it.quantity}매</div>
                        </div>
                      </div>
                      {gi !== undefined && (
                        <div className="mt-1 text-[11px] text-gray-400">→ 작업의뢰서 {gi + 1}번 줄</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* 오른쪽: 작업의뢰서 */}
        <section className="rounded-lg border bg-white">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">작업의뢰서 (규격별로 묶음)</h2>
            <span className="text-xs text-gray-500">{woItems.length}줄 · 담당자 확인</span>
          </header>
          <div className="max-h-[70vh] overflow-auto">
            <ul className="divide-y">
              {woItems.map((w, idx) => {
                const changed = !!w.source_product_name && w.source_product_name !== w.product_name;
                return (
                  <li key={w.id} className={`border-l-4 px-4 py-2.5 ${hue(idx)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-gray-400 tabular-nums">{idx + 1}</span>
                          <span className="truncate text-sm font-medium text-gray-900">{w.product_name}</span>
                          {changed && <Badge variant="secondary" className="text-[11px]">품명 수정</Badge>}
                        </div>
                        {changed && (
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                            <span className="line-through">{w.source_product_name}</span>
                            <ArrowRight className="h-3 w-3" />
                            <span className="text-gray-700">{w.product_name}</span>
                          </div>
                        )}
                        <div className="mt-0.5 text-xs text-gray-500">{w.location_summary || '-'}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs text-gray-600 tabular-nums">{w.width_mm} × {w.height_mm}</div>
                        <div className="text-sm font-medium text-gray-900 tabular-nums">{w.quantity}매</div>
                        {(w.source_item_count ?? 1) > 1 && (
                          <div className="text-[11px] text-gray-400">발주 {w.source_item_count}줄 묶음</div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>

      <p className="text-xs text-gray-500">
        왼쪽 줄과 오른쪽 줄의 색 띠가 같으면 같은 묶음입니다. 수량 합계가 다르면 위 대조 칸이 빨갛게 표시됩니다.
      </p>
    </div>
  );
}
