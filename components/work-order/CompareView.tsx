'use client';

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, Search, Columns2, Layers, ArrowRight } from 'lucide-react';

export interface CompareOrderItem {
  id: string;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  location_dong: string | null;
  location_line: string | null;
  location_floor: string | null;
  location_room: string | null;
  location_type: string | null;
  location_window_type: string | null;
  sort_order: number;
}

export interface CompareWoItem {
  id: string;
  product_name: string;
  source_product_name: string | null;
  location_summary: string | null;
  source_item_count: number | null;
  width_mm: number;
  height_mm: number;
  quantity: number;
  sort_order: number;
}

const HUES = [
  'bg-blue-400', 'bg-emerald-400', 'bg-amber-400', 'bg-violet-400',
  'bg-rose-400', 'bg-cyan-400', 'bg-lime-500', 'bg-orange-400',
];

function locationOf(it: CompareOrderItem): string {
  return [it.location_dong, it.location_line, it.location_floor, it.location_room, it.location_type, it.location_window_type]
    .filter(Boolean).join(' ') || '위치 없음';
}

export default function CompareView({
  orderItems,
  woItems,
}: {
  orderItems: CompareOrderItem[];
  woItems: CompareWoItem[];
}) {
  const [mode, setMode] = useState<'grouped' | 'side'>('grouped');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyChanged, setOnlyChanged] = useState(false);

  // 작업의뢰서 줄 ↔ 그 줄로 묶인 발주 품목들
  const groups = useMemo(() => {
    const byKey = new Map<string, CompareOrderItem[]>();
    for (const it of orderItems) {
      const key = `${it.product_name}|${it.width_mm}|${it.height_mm}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(it);
    }
    return woItems.map((w, idx) => {
      const key = `${w.source_product_name ?? w.product_name}|${w.width_mm}|${w.height_mm}`;
      const sources = byKey.get(key) ?? [];
      const srcQty = sources.reduce((s, i) => s + i.quantity, 0);
      return {
        wo: w,
        idx,
        sources,
        srcQty,
        changed: !!w.source_product_name && w.source_product_name !== w.product_name,
        qtyOk: sources.length === 0 || srcQty === w.quantity,
      };
    });
  }, [orderItems, woItems]);

  const matchedIds = useMemo(() => new Set(groups.flatMap(g => g.sources.map(s => s.id))), [groups]);
  const orphans = orderItems.filter(i => !matchedIds.has(i.id));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter(g => {
      if (onlyChanged && !g.changed) return false;
      if (!q) return true;
      return (
        g.wo.product_name.toLowerCase().includes(q) ||
        (g.wo.source_product_name ?? '').toLowerCase().includes(q) ||
        `${g.wo.width_mm}x${g.wo.height_mm}`.includes(q.replace(/\s|×/g, 'x')) ||
        (g.wo.location_summary ?? '').toLowerCase().includes(q)
      );
    });
  }, [groups, query, onlyChanged, ]);

  const totalSrcQty = orderItems.reduce((s, i) => s + i.quantity, 0);
  const totalWoQty = woItems.reduce((s, i) => s + i.quantity, 0);
  const changedCount = groups.filter(g => g.changed).length;
  const mismatch = groups.filter(g => !g.qtyOk).length;
  const qtyOk = totalSrcQty === totalWoQty && mismatch === 0 && orphans.length === 0;

  function toggle(id: string) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* 한 줄 요약 — 문제가 있으면 여기서 바로 보인다 */}
      <div
        className={`flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border px-5 py-4 ${
          qtyOk ? 'border-emerald-200 bg-emerald-50/70' : 'border-red-200 bg-red-50/70'
        }`}
      >
        <div>
          <div className={`text-sm font-semibold ${qtyOk ? 'text-emerald-800' : 'text-red-800'}`}>
            {qtyOk ? '원본과 수량이 모두 맞습니다' : '확인이 필요합니다'}
          </div>
          <div className="text-xs text-gray-600">
            {qtyOk
              ? '빠지거나 더해진 유리가 없습니다.'
              : [
                  totalSrcQty !== totalWoQty && `합계가 ${Math.abs(totalSrcQty - totalWoQty).toLocaleString()}매 다릅니다`,
                  mismatch > 0 && `${mismatch}줄의 수량이 안 맞습니다`,
                  orphans.length > 0 && `발주 ${orphans.length}줄이 어디에도 안 들어갔습니다`,
                ].filter(Boolean).join(' · ')}
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-7 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-gray-500">품목 줄</dt>
            <dd className="font-semibold text-gray-900 tabular-nums">
              {orderItems.length} <span className="font-normal text-gray-400">→</span> {woItems.length}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">총 수량</dt>
            <dd className="font-semibold tabular-nums">
              <span className={totalSrcQty === totalWoQty ? 'text-gray-900' : 'text-red-700'}>
                {totalSrcQty.toLocaleString()} <span className="font-normal text-gray-400">→</span> {totalWoQty.toLocaleString()}매
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">품명 고친 줄</dt>
            <dd className="font-semibold text-gray-900 tabular-nums">{changedCount}</dd>
          </div>
        </dl>
      </div>

      {/* 도구 막대 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="품명, 규격(905x1820), 위치로 찾기"
            className="h-9 pl-9 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlyChanged(v => !v)}
          className={`h-9 rounded-md border px-3 text-sm ${
            onlyChanged ? 'border-blue-300 bg-blue-50 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          품명 고친 줄만
        </button>
        <div className="flex h-9 overflow-hidden rounded-md border">
          <button
            type="button"
            onClick={() => setMode('grouped')}
            className={`flex items-center gap-1.5 px-3 text-sm ${mode === 'grouped' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <Layers className="h-3.5 w-3.5" />묶음 보기
          </button>
          <button
            type="button"
            onClick={() => setMode('side')}
            className={`flex items-center gap-1.5 border-l px-3 text-sm ${mode === 'side' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <Columns2 className="h-3.5 w-3.5" />나란히 보기
          </button>
        </div>
      </div>

      {/* 묶음 보기 — 작업의뢰서 한 줄을 펼치면 그 안에 묶인 발주 줄들이 나온다 */}
      {mode === 'grouped' && (
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="flex items-center gap-3 border-b bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500">
            <span className="w-6" />
            <span className="flex-1">작업의뢰서 품명</span>
            <span className="w-32 text-right">규격</span>
            <span className="w-20 text-right">수량</span>
            <span className="w-24 text-right">묶인 발주</span>
          </div>

          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-500">조건에 맞는 줄이 없습니다.</p>
          ) : (
            <ul className="divide-y">
              {filtered.map(g => {
                const isOpen = open.has(g.wo.id);
                return (
                  <li key={g.wo.id}>
                    <button
                      type="button"
                      onClick={() => toggle(g.wo.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                    >
                      <span className="flex w-6 items-center gap-1.5">
                        {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${HUES[g.idx % HUES.length]}`} />
                          <span className="text-sm font-medium text-gray-900">{g.wo.product_name}</span>
                          {g.changed && <Badge variant="secondary" className="text-[11px]">품명 수정</Badge>}
                          {!g.qtyOk && <Badge variant="destructive" className="text-[11px]">수량 불일치</Badge>}
                        </span>
                        {g.changed && (
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
                            <span className="line-through">{g.wo.source_product_name}</span>
                            <ArrowRight className="h-3 w-3" />
                            <span className="text-gray-700">{g.wo.product_name}</span>
                          </span>
                        )}
                        {g.wo.location_summary && (
                          <span className="mt-0.5 block truncate text-xs text-gray-500">{g.wo.location_summary}</span>
                        )}
                      </span>
                      <span className="w-32 shrink-0 text-right text-sm text-gray-700 tabular-nums">
                        {g.wo.width_mm.toLocaleString()} × {g.wo.height_mm.toLocaleString()}
                      </span>
                      <span className="w-20 shrink-0 text-right text-sm font-medium text-gray-900 tabular-nums">
                        {g.wo.quantity.toLocaleString()}매
                      </span>
                      <span className="w-24 shrink-0 text-right text-xs text-gray-500 tabular-nums">
                        {g.sources.length > 0 ? `${g.sources.length}줄` : '원본 없음'}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="border-t bg-gray-50/70 px-4 py-3">
                        <p className="mb-2 text-xs text-gray-500">
                          발주의뢰서 원본 {g.sources.length}줄 · 합계 {g.srcQty.toLocaleString()}매
                          {!g.qtyOk && <span className="ml-2 text-red-600">작업의뢰서 {g.wo.quantity.toLocaleString()}매와 다릅니다</span>}
                        </p>
                        {g.sources.length === 0 ? (
                          <p className="text-xs text-gray-500">이 줄과 짝지어지는 발주 품목을 찾지 못했습니다.</p>
                        ) : (
                          <ul className="space-y-1">
                            {g.sources.map(s => (
                              <li key={s.id} className="flex flex-wrap items-center gap-x-4 text-xs text-gray-700">
                                <span className="w-28 shrink-0 tabular-nums">{s.width_mm} × {s.height_mm}</span>
                                <span className="w-14 shrink-0 text-right tabular-nums">{s.quantity}매</span>
                                <span className="text-gray-500">{locationOf(s)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* 나란히 보기 */}
      {mode === 'side' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border bg-white">
            <header className="flex items-center justify-between border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold text-gray-900">발주의뢰서 (원본)</h2>
              <span className="text-xs text-gray-500">{orderItems.length}줄</span>
            </header>
            <ul className="max-h-[65vh] divide-y overflow-auto">
              {orderItems.map(it => {
                const g = groups.find(gr => gr.sources.some(s => s.id === it.id));
                return (
                  <li key={it.id} className="flex items-start gap-2.5 px-4 py-2">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${g ? HUES[g.idx % HUES.length] : 'bg-gray-200'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-gray-900">{it.product_name}</div>
                      <div className="text-xs text-gray-500">{locationOf(it)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-gray-600 tabular-nums">{it.width_mm} × {it.height_mm}</div>
                      <div className="text-sm text-gray-900 tabular-nums">{it.quantity}매</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-lg border bg-white">
            <header className="flex items-center justify-between border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold text-gray-900">작업의뢰서 (묶음)</h2>
              <span className="text-xs text-gray-500">{woItems.length}줄</span>
            </header>
            <ul className="max-h-[65vh] divide-y overflow-auto">
              {groups.map(g => (
                <li key={g.wo.id} className="flex items-start gap-2.5 px-4 py-2">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${HUES[g.idx % HUES.length]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">{g.wo.product_name}</span>
                      {g.changed && <Badge variant="secondary" className="text-[11px]">수정</Badge>}
                    </div>
                    <div className="truncate text-xs text-gray-500">{g.wo.location_summary || '-'}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs text-gray-600 tabular-nums">{g.wo.width_mm} × {g.wo.height_mm}</div>
                    <div className="text-sm text-gray-900 tabular-nums">{g.wo.quantity}매</div>
                    <div className="text-[11px] text-gray-400">발주 {g.sources.length}줄</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* 어디에도 안 들어간 발주 줄 */}
      {orphans.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="mb-2 text-sm font-semibold text-red-800">
            작업의뢰서에 들어가지 않은 발주 품목 {orphans.length}줄
          </p>
          <ul className="space-y-1">
            {orphans.slice(0, 10).map(o => (
              <li key={o.id} className="flex flex-wrap gap-x-4 text-xs text-red-900">
                <span>{o.product_name}</span>
                <span className="tabular-nums">{o.width_mm} × {o.height_mm}</span>
                <span className="tabular-nums">{o.quantity}매</span>
                <span>{locationOf(o)}</span>
              </li>
            ))}
            {orphans.length > 10 && <li className="text-xs text-red-700">외 {orphans.length - 10}줄</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
