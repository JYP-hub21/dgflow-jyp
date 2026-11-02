'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { dayLabel, groupByDate, monthLabel, type DateLog } from '@/lib/production/by-date';
import { itemNo } from '@/lib/production/item-view';
import { lineName } from '@/lib/production/lines';
import { useProductionLines } from './useProductionLines';

export interface ByDateItem {
  id: string;
  product_name: string;
  width_mm: number;
  height_mm: number;
  remark?: string | null;
  item_no?: number | null;
  sort_order?: number | null;
}

/**
 * 날짜별 생산 — 한 작업의뢰서를 며칠 · 몇 주에 걸쳐 만들 때 (2026-11-02 사용자: "날짜가 많아지면 곤란, 방법을 강구").
 * 월 → 날짜 한 줄씩 접어 두고, 날짜를 누르면 그날 만든 품목(No. · 품명 · 규격 · 수량 · 주야 · 호기)이 펼쳐진다.
 * 날짜가 수십 개여도 화면은 날짜 수만큼의 짧은 줄뿐이다. 맨 위 날짜(가장 최근)는 펼쳐 둔다.
 */
export default function ProductionByDate({ logs, items }: { logs: DateLog[]; items: ByDateItem[] }) {
  const { lines } = useProductionLines();
  const itemMap = useMemo(() => new Map(items.map((it, i) => [it.id, { ...it, no: itemNo(it, i) }])), [items]);
  const months = useMemo(
    () => groupByDate(logs, id => (id ? itemMap.get(id)?.no ?? 9999 : 9999)),
    [logs, itemMap],
  );
  const allDates = months.flatMap(m => m.days.map(d => d.date));
  // 아직 아무것도 안 눌렀으면(null) 가장 최근 날짜만 펼쳐 둔다 — 기록을 늦게 받아도 그렇게 보이게
  const [touched, setOpen] = useState<Set<string> | null>(null);
  const open = touched ?? new Set(allDates.slice(0, 1));
  const toggle = (date: string) => {
    const next = new Set(open);
    if (next.has(date)) next.delete(date); else next.add(date);
    setOpen(next);
  };

  if (allDates.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-muted-foreground">아직 생산 기록이 없습니다.</p>;
  }
  const total = months.reduce((s, m) => s + m.quantity, 0);
  const first = allDates[allDates.length - 1];
  const last = allDates[0];
  const allOpen = open.size === allDates.length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3 text-sm">
        <p>
          <b>{allDates.length}일</b>에 걸쳐 <b className="tabular">{total.toLocaleString()}장</b>
          <span className="text-muted-foreground"> · {dayLabel(first)}{first !== last && ` 부터 ${dayLabel(last)} 까지`}</span>
        </p>
        <Button variant="ghost" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set(allDates))} className="text-muted-foreground">
          {allOpen ? <><ChevronsDownUp />모두 접기</> : <><ChevronsUpDown />모두 펼치기</>}
        </Button>
      </div>

      {months.map(m => (
        <section key={m.month}>
          <div className="flex items-center justify-between bg-muted/60 px-5 py-2 text-xs font-semibold text-muted-foreground">
            <span>{monthLabel(m.month)} · {m.days.length}일</span>
            <span className="tabular">{m.quantity.toLocaleString()}장 · {m.area_m2.toFixed(1)}㎡</span>
          </div>
          <ul className="divide-y">
            {m.days.map(d => {
              const isOpen = open.has(d.date);
              return (
                <li key={d.date}>
                  <button type="button" onClick={() => toggle(d.date)} aria-expanded={isOpen}
                    className={cn('flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-muted/40', isOpen && 'bg-brand-50/60')}>
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="tabular w-24 shrink-0 font-semibold">{dayLabel(d.date)}</span>
                    <span className="tabular font-bold text-brand-800">{d.quantity.toLocaleString()}장</span>
                    <span className="text-xs text-muted-foreground">{d.itemCount}품목 · {d.area_m2.toFixed(2)}㎡</span>
                  </button>
                  {isOpen && (
                    <ul className="space-y-1 bg-muted/20 px-5 pb-3 pt-1 sm:pl-12">
                      {d.rows.map((r, i) => {
                        const it = r.itemId ? itemMap.get(r.itemId) : undefined;
                        return (
                          <li key={i} className="flex items-start gap-3 rounded-lg bg-card px-3 py-2 text-sm shadow-xs">
                            <span className="tabular w-8 shrink-0 pt-0.5 text-center text-xs font-bold text-muted-foreground">{it ? it.no : '-'}</span>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold leading-snug">{it?.product_name ?? '품목 없음'}</p>
                              <p className="text-xs text-muted-foreground">
                                {it && <span className="tabular">{it.width_mm} × {it.height_mm}</span>}
                                {it?.remark && <span> · {it.remark}</span>}
                              </p>
                            </div>
                            <span className="shrink-0 text-right">
                              <b className="tabular text-base">{r.quantity}</b><span className="text-xs text-muted-foreground">장</span>
                              <span className="block text-[11px] text-muted-foreground">{r.shift === 'night' ? '야간' : '주간'} · {lineName(lines, r.line)}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
