'use client';

import { Fragment, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { dayLabel, groupByDate, monthLabel, type DateLog, type DayGroup } from '@/lib/production/by-date';
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

// 생산관리부 주황 — 대시보드 생산 막대와 같은 색 (흰 바탕 대비 검사 통과)
const BAR = '#BF4700';
const BAR_SOFT = '#F6D3BD';
/** 이 날 수까지는 달력 그대로(쉰 날은 빈칸), 넘으면 생산한 날만 */
const CALENDAR_DAYS = 62;

const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * 날짜별 생산 — 한 작업의뢰서를 며칠 · 몇 주에 걸쳐 만들 때 (2026-11-02 "날짜가 많아지면 곤란 · 한눈에 쫙 들어오게").
 *
 *  1. 요약 네 칸 — 생산한 날 · 총 생산 · 하루 평균 · 가장 많이 만든 날
 *  2. 날마다 만든 수량 막대 — 쉰 날은 빈칸이라 흐름이 보인다. 막대를 누르면 아래에서 그날이 펼쳐진다
 *  3. 월 → 날짜 목록 — 한 줄에 그날 수량과 짧은 막대, 누르면 그날 품목(No. · 규격 · 수량 · 주야 · 호기)
 */
export default function ProductionByDate({ logs, items, compact = false }: {
  logs: DateLog[];
  items: ByDateItem[];
  /** 좁은 자리(작업의뢰서 화면 반쪽) — 요약을 두 줄로 */
  compact?: boolean;
}) {
  const { lines } = useProductionLines();
  const itemMap = useMemo(() => new Map(items.map((it, i) => [it.id, { ...it, no: itemNo(it, i) }])), [items]);
  const months = useMemo(
    () => groupByDate(logs, id => (id ? itemMap.get(id)?.no ?? 9999 : 9999)),
    [logs, itemMap],
  );
  const days = months.flatMap(m => m.days);
  const allDates = days.map(d => d.date);

  // 아직 아무것도 안 눌렀으면(null) 가장 최근 날짜만 펼쳐 둔다
  const [touched, setOpen] = useState<Set<string> | null>(null);
  const open = touched ?? new Set(allDates.slice(0, 1));
  const toggle = (date: string) => {
    const next = new Set(open);
    if (next.has(date)) next.delete(date); else next.add(date);
    setOpen(next);
  };
  const focusDay = (date: string) => {
    setOpen(new Set([...open, date]));
    requestAnimationFrame(() => document.getElementById(`day-${date}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  if (days.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-5 py-12 text-center text-sm text-muted-foreground">
        <CalendarDays className="h-8 w-8 text-muted-foreground/50" />
        아직 생산 기록이 없습니다. 품목별 입력에서 저장하면 날짜별로 모입니다.
      </div>
    );
  }

  const first = allDates[allDates.length - 1];
  const last = allDates[0];
  const span = daysBetween(first, last) + 1;
  const total = days.reduce((s, d) => s + d.quantity, 0);
  const area = days.reduce((s, d) => s + d.area_m2, 0);
  const best = days.reduce((a, b) => (b.quantity > a.quantity ? b : a));
  const max = best.quantity;

  // 막대 — 기간이 짧으면 달력 그대로(쉰 날 0), 길면 생산한 날만
  const byDate = new Map(days.map(d => [d.date, d]));
  const chart = (span <= CALENDAR_DAYS
    ? Array.from({ length: span }, (_, i) => addDays(first, i))
    : [...allDates].reverse()
  ).map(date => ({ date, label: shortDate(date), quantity: byDate.get(date)?.quantity ?? 0, items: byDate.get(date)?.itemCount ?? 0 }));
  const allOpen = open.size === allDates.length;

  return (
    <div>
      {/* 1. 요약 */}
      <div className={cn('grid gap-px border-b bg-border', compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4')}>
        <Stat label="생산한 날" value={`${days.length}일`} sub={first === last ? dayLabel(first) : `${shortDate(first)} – ${shortDate(last)} · ${span}일 동안`} />
        <Stat label="총 생산" value={`${total.toLocaleString()}장`} sub={`${area.toFixed(1)}㎡`} />
        <Stat label="하루 평균" value={`${Math.round(total / days.length).toLocaleString()}장`} sub="생산한 날 기준" />
        <Stat label="가장 많이 만든 날" value={dayLabel(best.date)} sub={`${best.quantity.toLocaleString()}장 · ${best.itemCount}품목`} />
      </div>

      {/* 2. 날마다 만든 수량 */}
      <div className="border-b px-3 pb-2 pt-4 sm:px-5">
        <p className="mb-2 px-1 text-xs font-semibold text-muted-foreground">
          날마다 만든 수량 <span className="font-normal">— 막대를 누르면 그날 품목이 아래에 펼쳐집니다{span > CALENDAR_DAYS && ' (생산한 날만)'}</span>
        </p>
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 16, right: 4, left: -8, bottom: 0 }} barCategoryGap={chart.length > 20 ? 2 : '28%'}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
              <Tooltip cursor={{ fill: 'var(--muted)' }} content={<DayTip />} />
              <Bar dataKey="quantity" radius={[4, 4, 0, 0]} maxBarSize={36} className="cursor-pointer"
                onClick={(d: { payload?: { date: string; quantity: number } }) => d.payload?.quantity && focusDay(d.payload.date)}
                label={({ x, y, width, value }: { x?: number; y?: number; width?: number; value?: number }) =>
                  value === max && value ? (
                    <text x={(x ?? 0) + (width ?? 0) / 2} y={(y ?? 0) - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--foreground)">{value}</text>
                  ) : <g />}>
                {chart.map(c => <Cell key={c.date} fill={open.has(c.date) ? BAR : c.quantity ? BAR : BAR_SOFT} fillOpacity={open.has(c.date) ? 1 : 0.78} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3. 월 → 날짜 */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <p className="text-xs font-semibold text-muted-foreground">날짜별 품목</p>
        <Button variant="ghost" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set(allDates))} className="h-8 text-muted-foreground">
          {allOpen ? <><ChevronsDownUp />모두 접기</> : <><ChevronsUpDown />모두 펼치기</>}
        </Button>
      </div>
      {months.map(m => (
        <section key={m.month}>
          <div className="flex items-center justify-between border-y bg-muted/50 px-5 py-1.5 text-xs font-semibold text-muted-foreground">
            <span>{monthLabel(m.month)} · {m.days.length}일</span>
            <span className="tabular">{m.quantity.toLocaleString()}장 · {m.area_m2.toFixed(1)}㎡</span>
          </div>
          <ul className="divide-y">
            {m.days.map(d => (
              <DayRow key={d.date} day={d} max={max} isOpen={open.has(d.date)} onToggle={() => toggle(d.date)}>
                {d.rows.map((r, i) => {
                  const it = r.itemId ? itemMap.get(r.itemId) : undefined;
                  const prev = i > 0 && d.rows[i - 1].itemId ? itemMap.get(d.rows[i - 1].itemId!) : undefined;
                  // 품명이 바뀌는 곳에만 작은 머리 — 줄마다 품명을 되풀이하지 않는다
                  const newBlock = i === 0 || prev?.product_name !== it?.product_name;
                  return (
                    <Fragment key={i}>
                    {newBlock && <li className="px-1 pt-1.5 text-xs font-bold text-foreground/80">{it?.product_name ?? '품목 없음'}</li>}
                    <li className="flex items-start gap-3 rounded-lg bg-card px-3 py-2 text-sm shadow-xs">
                      <span className="tabular w-8 shrink-0 pt-0.5 text-center text-xs font-bold text-muted-foreground">{it ? it.no : '-'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">{it?.remark || <span className="text-muted-foreground">비고 없음</span>}</p>
                        {it && <p className="tabular text-xs text-foreground/70">{it.width_mm} × {it.height_mm}</p>}
                      </div>
                      <span className="shrink-0 text-right">
                        <b className="tabular text-base">{r.quantity}</b><span className="text-xs text-muted-foreground">장</span>
                        <span className="block text-[11px] text-muted-foreground">{r.shift === 'night' ? '야간' : '주간'} · {lineName(lines, r.line)}</span>
                      </span>
                    </li>
                    </Fragment>
                  );
                })}
              </DayRow>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card px-5 py-3.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 text-lg font-bold tracking-tight">{value}</p>
      <p className="tabular truncate text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

/** 날짜 한 줄 — 그날 수량을 짧은 막대로도 보여 줘서 많이 만든 날이 한눈에 들어온다 */
function DayRow({ day, max, isOpen, onToggle, children }: {
  day: DayGroup; max: number; isOpen: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <li id={`day-${day.date}`}>
      <button type="button" onClick={onToggle} aria-expanded={isOpen}
        className={cn('flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted/40', isOpen && 'bg-brand-50/60')}>
        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="tabular w-[5.5rem] shrink-0 font-semibold">{dayLabel(day.date)}</span>
        <span className="relative hidden h-2 flex-1 overflow-hidden rounded-full bg-muted sm:block">
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(4, (day.quantity / max) * 100)}%`, background: BAR }} />
        </span>
        <span className="tabular ml-auto w-16 shrink-0 text-right font-bold sm:ml-0">{day.quantity.toLocaleString()}장</span>
        <span className="tabular w-14 shrink-0 text-right text-xs text-muted-foreground">{day.itemCount}품목</span>
      </button>
      {isOpen && <ul className="space-y-1 bg-muted/20 px-4 pb-3 pt-1 sm:pl-12 sm:pr-5">{children}</ul>}
    </li>
  );
}

function DayTip({ active, payload }: { active?: boolean; payload?: { payload: { date: string; quantity: number; items: number } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-bold text-foreground">{dayLabel(p.date)}</p>
      <p className="tabular text-muted-foreground">
        {p.quantity ? <><b className="text-foreground">{p.quantity.toLocaleString()}장</b> · {p.items}품목</> : '생산 없음'}
      </p>
    </div>
  );
}
