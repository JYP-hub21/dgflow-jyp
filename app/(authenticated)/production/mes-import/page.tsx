'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, CheckCircle2, ClipboardCheck, FileSearch, FileSpreadsheet, Info, Loader2, Upload,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button, buttonVariants } from '@/components/ui/button';
import { chipClass } from '@/components/ui/chip';
import { useFileDrop } from '@/components/ui/file-drop';
import { useProductionLines } from '@/components/production/useProductionLines';
import { lineName } from '@/lib/production/lines';
import { cn } from '@/lib/utils';
import { readMesFile } from '@/lib/production/mes-client';
import {
  MES_COMMIT_ENABLED, SHIFT_TEXT, STATUS_TEXT, groupPieces, isInsert, planMesImport, type MesDbOrder, type MesParse, type MesPlanRow,
} from '@/lib/production/mes';

/**
 * MES 생산실적 가져오기 (2026-11-13 이사님 요청 — 생산관리부 담당자의 생산 입력을 줄이려고).
 *
 *  1) MES 생산실적 엑셀을 올린다 — 작업자 스레드에서 읽고, 아직 아무것도 저장하지 않는다
 *  2) 기간을 고른다 (처음엔 파일의 마지막 날부터 3주 — 이사님: "2~3주치만 테스트")
 *  3) 의뢰번호로 시스템의 작업의뢰서를 찾아 넣을 계획을 보여 준다 — 요약 → 날짜별 그래프 → 목록
 *  4) '생산 실적 등록' — 서버가 다시 계산해 모자란 만큼만 넣는다. 같은 파일을 다시 올려도 두 번 들어가지 않는다
 * 주간 · 야간은 바코드를 찍은 시각으로 가른다 — 18:00 부터 야간 (2026-11-13 회의, lib/production/mes.ts NIGHT_FROM_MINUTES).
 */
const PREVIEW_ROWS = 50;
const CHECK_BATCH = 1000;
const COMMIT_BATCH = 1000;

type Preset = '2w' | '3w' | '1m' | 'all' | 'custom';
type Tab = 'insert' | 'missing' | 'review' | 'done';

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;

// 그래프 색 — 등록할 것(남색) · 이미 들어간 것(초록) · 넣지 못하는 것(회색)
const C_INSERT = 'var(--brand-600)';
const C_DONE = 'var(--success)';
const C_BLOCKED = '#B8BEC7';

export default function MesImportPage() {
  const { lines } = useProductionLines();
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [readRows, setReadRows] = useState(0);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<MesParse | null>(null);
  const [preset, setPreset] = useState<Preset>('3w');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [orders, setOrders] = useState<Map<string, MesDbOrder>>(new Map());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [checkError, setCheckError] = useState('');
  const [tab, setTab] = useState<Tab>('insert');
  const [showAll, setShowAll] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ inserted: number; quantity: number; items: number; orders: number } | null>(null);

  const { dragging, dropProps } = useFileDrop({
    onFiles: (files) => void onFile(files[0]), accept: '.xlsx,.xls,.csv', multiple: false, disabled: reading || !!progress,
  });

  const fileSpan = useMemo(() => {
    if (!parsed || parsed.pieces.length === 0) return null;
    let min = parsed.pieces[0].date, max = min;
    for (const p of parsed.pieces) { if (p.date < min) min = p.date; if (p.date > max) max = p.date; }
    return { min, max };
  }, [parsed]);

  function applyPreset(p: Preset, span = fileSpan) {
    setPreset(p);
    setShowAll(false);
    if (!span || p === 'custom') return;
    const back = { '2w': 13, '3w': 20, '1m': 29, all: Infinity }[p];
    const from = back === Infinity ? span.min : addDays(span.max, -back);
    setRange({ from: from < span.min ? span.min : from, to: span.max });
  }

  async function onFile(file: File) {
    setReading(true);
    setReadRows(0);
    setError('');
    setParsed(null);
    setResult(null);
    setFileName(file.name);
    try {
      const res = await readMesFile(file, setReadRows);
      if (res.pieces.length === 0) throw new Error('바코드 기록이 한 줄도 없습니다. MES 생산실적 엑셀인지 확인하세요.');
      setParsed(res);
      let min = res.pieces[0].date, max = min;
      for (const p of res.pieces) { if (p.date < min) min = p.date; if (p.date > max) max = p.date; }
      applyPreset('3w', { min, max });
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 읽지 못했습니다.');
    } finally {
      setReading(false);
    }
  }

  const groups = useMemo(
    () => (parsed && range ? groupPieces(parsed.pieces, range.from, range.to) : []),
    [parsed, range],
  );
  const numbers = useMemo(() => [...new Set(groups.map(g => g.wo))], [groups]);
  const unchecked = numbers.filter(n => !checked.has(n));

  // 기간 안 의뢰번호 중 아직 확인하지 않은 것을 시스템에서 찾는다 (읽기만 한다)
  useEffect(() => {
    if (unchecked.length === 0) return;
    let cancelled = false;
    (async () => {
      setCheckError('');
      try {
        const found: MesDbOrder[] = [];
        for (let i = 0; i < unchecked.length; i += CHECK_BATCH) {
          const res = await fetch('/api/production/mes-import', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'check', numbers: unchecked.slice(i, i + CHECK_BATCH) }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || '작업의뢰서를 확인하지 못했습니다.');
          found.push(...(body.orders as MesDbOrder[]));
        }
        if (cancelled) return;
        setOrders(prev => { const next = new Map(prev); for (const o of found) next.set(o.work_order_number, o); return next; });
        setChecked(prev => new Set([...prev, ...unchecked]));
      } catch (e) {
        if (!cancelled) setCheckError(e instanceof Error ? e.message : '작업의뢰서를 확인하지 못했습니다.');
      }
    })();
    return () => { cancelled = true; };
  }, [unchecked.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = parsed !== null && unchecked.length === 0 && !checkError;
  const plan = useMemo(() => (ready ? planMesImport(groups, orders) : []), [ready, groups, orders]);

  const s = useMemo(() => {
    const by = (f: (r: MesPlanRow) => boolean) => plan.filter(f);
    const insert = by(isInsert);
    const missingRows = by(r => r.status === 'no-order');
    const review = by(r => r.status === 'over' || r.status === 'partial' || r.status === 'no-item' || r.status === 'size' || r.status === 'line');
    const done = by(r => r.status === 'done');
    const missing = new Map<string, { wo: string; customer: string; site: string; items: Set<number>; count: number; first: string; last: string }>();
    for (const r of missingRows) {
      const m = missing.get(r.wo) ?? { wo: r.wo, customer: r.customer, site: r.site, items: new Set(), count: 0, first: r.date, last: r.date };
      m.items.add(r.no); m.count += r.count;
      if (r.date < m.first) m.first = r.date;
      if (r.date > m.last) m.last = r.date;
      if (!m.site && r.site) m.site = r.site;
      missing.set(r.wo, m);
    }
    return {
      pieces: groups.reduce((t, g) => t + g.count, 0),
      items: new Set(groups.map(g => `${g.wo}|${g.no}`)).size,
      insert, insertQty: insert.reduce((t, r) => t + r.add, 0),
      insertOrders: new Set(insert.map(r => r.wo)).size,
      missing: [...missing.values()].sort((a, b) => a.wo.localeCompare(b.wo)),
      missingQty: missingRows.reduce((t, r) => t + r.count, 0),
      review, done,
      doneQty: done.reduce((t, r) => t + r.count, 0),
      registered: numbers.filter(n => orders.has(n)).length,
    };
  }, [plan, groups, numbers, orders]);

  // 날짜별 — 쉰 날도 칸을 두어 흐름이 보이게
  const chart = useMemo(() => {
    if (!range || plan.length === 0) return [];
    const map = new Map<string, { insert: number; done: number; blocked: number }>();
    for (const r of plan) {
      const d = map.get(r.date) ?? { insert: 0, done: 0, blocked: 0 };
      const already = r.status === 'add' || r.status === 'partial' || r.status === 'done' ? Math.min(r.already, r.count) : 0;
      d.insert += r.add;
      d.done += already;
      d.blocked += Math.max(0, r.count - r.add - already);
      map.set(r.date, d);
    }
    const span = daysBetween(range.from, range.to);
    const dates = Array.from({ length: span }, (_, i) => addDays(range.from, i));
    const zero = { insert: 0, done: 0, blocked: 0 };
    if (span <= 62) return dates.map(date => ({ date, label: shortDate(date), weekly: false, ...(map.get(date) ?? zero) }));
    // 두 달이 넘으면 막대가 실처럼 가늘어져 주(월요일 시작) 단위로 묶는다
    const weeks = new Map<string, { date: string; label: string; weekly: boolean; insert: number; done: number; blocked: number }>();
    for (const date of dates) {
      const dow = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
      const monday = addDays(date, -dow);
      const w = weeks.get(monday) ?? { date: monday, label: shortDate(monday), weekly: true, ...zero };
      const d = map.get(date);
      if (d) { w.insert += d.insert; w.done += d.done; w.blocked += d.blocked; }
      weeks.set(monday, w);
    }
    return [...weeks.values()];
  }, [plan, range]);

  async function runImport() {
    if (s.insert.length === 0) return;
    if (!window.confirm(
      `생산 실적 ${s.insert.length.toLocaleString()}건(${s.insertQty.toLocaleString()}조)을 등록합니다.\n`
      + '주간 · 야간은 바코드를 찍은 시각으로 나눠 등록합니다(18:00부터 야간). 계속하시겠습니까?',
    )) return;
    // 같은 의뢰번호는 한 번에 보낸다 — 서버가 품목별로 의뢰 수량을 넘지 않게 다시 계산한다
    const byWo = new Map<string, MesPlanRow[]>();
    for (const r of s.insert) byWo.set(r.wo, [...(byWo.get(r.wo) ?? []), r]);
    const batches: MesPlanRow[][] = [];
    let cur: MesPlanRow[] = [];
    for (const list of byWo.values()) {
      if (cur.length > 0 && cur.length + list.length > COMMIT_BATCH) { batches.push(cur); cur = []; }
      cur.push(...list);
    }
    if (cur.length) batches.push(cur);

    setProgress({ done: 0, total: s.insert.length });
    setError('');
    const total = { inserted: 0, quantity: 0, items: 0, orders: 0 };
    let sent = 0;
    try {
      for (const batch of batches) {
        const res = await fetch('/api/production/mes-import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'commit',
            groups: batch.map(r => ({ wo: r.wo, no: r.no, date: r.date, line: r.line, shift: r.shift, count: r.count, width: r.width, height: r.height })),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || '등록하지 못했습니다.');
        total.inserted += body.inserted ?? 0;
        total.quantity += body.quantity ?? 0;
        total.items += body.items ?? 0;
        total.orders += body.orders ?? 0;
        sent += batch.length;
        setProgress({ done: sent, total: s.insert.length });
      }
      setResult(total);
      toast.success(`생산 실적 ${total.quantity.toLocaleString()}조를 등록했습니다.`);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : '등록하지 못했습니다.'} — 그때까지 ${total.quantity.toLocaleString()}조는 들어갔습니다. 다시 누르면 들어간 것은 건너뜁니다.`);
    } finally {
      setProgress(null);
      // 방금 넣은 것까지 다시 읽어 계획을 새로 그린다
      setOrders(new Map());
      setChecked(new Set());
    }
  }

  const thin = chart.length > 40;
  const fileQty = useMemo(() => parsed?.pieces.reduce((t, p) => t + p.qty, 0) ?? 0, [parsed]);
  const tabRows: MesPlanRow[] = tab === 'insert' ? s.insert : tab === 'review' ? s.review : tab === 'done' ? s.done : [];
  const tabCount = tab === 'missing' ? s.missing.length : tabRows.length;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        back={{ href: '/production', label: '생산 현황' }}
        title="MES 생산실적 가져오기"
        description="MES 에서 내려받은 생산실적 엑셀(포장공정 바코드)을 업로드하면 의뢰번호 · NO 로 작업의뢰서 품목을 찾아 생산 실적으로 등록합니다. 파일을 선택하면 먼저 미리보기를 표시하고, 확인 후 등록합니다."
      />

      {/* 1. 파일 */}
      <Card {...dropProps} className={cn('border-2 border-dashed border-transparent transition-colors', dragging && 'border-brand-600 bg-brand-50')}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-800"><FileSpreadsheet className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{fileName || 'MES 생산실적 엑셀'}</p>
              <p className="text-xs text-muted-foreground">
                {reading
                  ? `읽는 중… ${readRows.toLocaleString()}줄`
                  : parsed
                    ? `${parsed.sheet} 시트 · 바코드 ${fileQty.toLocaleString()}장 · ${fileSpan ? `${fileSpan.min} – ${fileSpan.max}` : ''}`
                    : 'xlsx · xls · csv — 의뢰번호 · NO. · 라인 · 일자 칸이 있어야 합니다'}
              </p>
              <p className="mt-0.5 text-xs font-medium text-brand-800">{dragging ? '여기에 놓으세요' : '파일을 이 영역에 끌어다 놓아도 됩니다'}</p>
            </div>
          </div>
          <label className={cn('inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand-800 px-4 text-sm font-semibold text-white hover:bg-brand-700', (reading || progress) && 'pointer-events-none opacity-60')}>
            {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {reading ? '읽는 중…' : parsed ? '다른 파일 선택' : '파일 선택'}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
          </label>
        </CardContent>
      </Card>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive">{error}</p>}

      {parsed && range && fileSpan && (
        <>
          {/* 2. 기간 */}
          <Card className="gap-0 py-4">
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5">
              <p className="text-sm font-bold">등록 기간</p>
              <div className="flex flex-wrap gap-2">
                {([['2w', '최근 2주'], ['3w', '최근 3주'], ['1m', '최근 한 달'], ['all', '파일 전체']] as const).map(([p, label]) => (
                  <button key={p} type="button" className={chipClass(preset === p)} onClick={() => applyPreset(p)} disabled={!!progress}>{label}</button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <input type="date" aria-label="시작일" value={range.from} min={fileSpan.min} max={range.to} disabled={!!progress}
                  onChange={e => { if (e.target.value) { setPreset('custom'); setShowAll(false); setRange({ ...range, from: e.target.value }); } }}
                  className="h-9 rounded-lg border border-input bg-card px-2.5 tabular" />
                <span className="text-muted-foreground">–</span>
                <input type="date" aria-label="종료일" value={range.to} min={range.from} max={fileSpan.max} disabled={!!progress}
                  onChange={e => { if (e.target.value) { setPreset('custom'); setShowAll(false); setRange({ ...range, to: e.target.value }); } }}
                  className="h-9 rounded-lg border border-input bg-card px-2.5 tabular" />
              </div>
              <p className="text-xs text-muted-foreground sm:ml-auto">파일 기간 {fileSpan.min} – {fileSpan.max}</p>
            </CardContent>
          </Card>

          {(parsed.skipped.length > 0 || parsed.duplicates > 0) && (
            <details className="rounded-lg border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm">
              <summary className="cursor-pointer font-semibold">
                파일에서 제외한 줄 {(parsed.skipped.reduce((t, x) => t + x.count, 0) + parsed.duplicates).toLocaleString()}개
              </summary>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {parsed.duplicates > 0 && <li>같은 바코드가 다시 찍힌 줄 {parsed.duplicates.toLocaleString()}개 — 한 번만 셉니다</li>}
                {parsed.skipped.map(x => <li key={x.reason}>{x.reason} {x.count.toLocaleString()}줄 (엑셀 {x.rows.join(', ')}행{x.count > x.rows.length ? ' 등' : ''})</li>)}
              </ul>
            </details>
          )}

          {checkError && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive">{checkError}</p>}

          {!ready && !checkError && (
            <Card><CardContent className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />의뢰번호 {numbers.length.toLocaleString()}건을 시스템의 작업의뢰서와 대조하는 중입니다…</CardContent></Card>
          )}

          {ready && (
            <>
              {/* 3. 요약 */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="기간 내 바코드" value={`${s.pieces.toLocaleString()}장`} sub={`${range.from.slice(5)} – ${range.to.slice(5)} · ${daysBetween(range.from, range.to)}일`} />
                <Stat label="의뢰번호" value={`${numbers.length.toLocaleString()}건`} sub={`품목 ${s.items.toLocaleString()}줄 · 시스템 등록 ${s.registered}건`} />
                <Stat label="등록할 생산 실적" value={`${s.insertQty.toLocaleString()}조`} sub={`${s.insert.length.toLocaleString()}건 · 의뢰서 ${s.insertOrders}건`} strong />
                <Stat label="작업의뢰서 미등록" value={`${s.missing.length.toLocaleString()}건`} sub={`${s.missingQty.toLocaleString()}장 — 의뢰서 등록 후 가져올 수 있습니다`} warn={s.missing.length > 0} />
              </div>

              {/* 4. 날짜별 */}
              <Card className="gap-0 py-0">
                <CardContent className="px-3 pb-2 pt-4 sm:px-5">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                    <p className="text-xs font-semibold text-muted-foreground">{chart[0]?.weekly ? '주별 바코드 장수 (월요일 시작)' : '일별 바코드 장수'}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-foreground">
                      <Legend color={C_INSERT} label="등록할 실적" />
                      <Legend color={C_DONE} label="이미 등록됨" />
                      <Legend color={C_BLOCKED} label="등록 불가(미등록 · 확인 필요)" />
                    </div>
                  </div>
                  <div className="h-44 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chart} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap={chart.length > 20 ? 2 : '28%'}>
                        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14}
                          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                        <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={44}
                          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                        <Tooltip cursor={{ fill: 'var(--muted)' }} content={<DayTip />} />
                        {/* 막대 사이 흰 줄은 막대가 넓을 때만 — 날이 많아 가늘어지면 흰 줄이 막대를 덮는다 */}
                        <Bar dataKey="done" stackId="a" fill={C_DONE} stroke={thin ? 'none' : 'var(--card)'} strokeWidth={1} maxBarSize={36} />
                        <Bar dataKey="insert" stackId="a" fill={C_INSERT} stroke={thin ? 'none' : 'var(--card)'} strokeWidth={1} maxBarSize={36} />
                        <Bar dataKey="blocked" stackId="a" fill={C_BLOCKED} stroke={thin ? 'none' : 'var(--card)'} strokeWidth={1} radius={thin ? 0 : [4, 4, 0, 0]} maxBarSize={36} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* 5. 등록 */}
              <Card>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 text-sm">
                      <p className="font-bold">생산 실적 등록</p>
                      <p className="mt-0.5 break-keep text-muted-foreground">
                        {s.insert.length > 0
                          ? <>등록하면 의뢰서 {s.insertOrders}건의 품목에 <b className="text-foreground">{s.insertQty.toLocaleString()}조</b>가 생산 실적으로 들어가고, 생산일지에 바로 반영됩니다.</>
                          : '이 기간에 새로 등록할 실적이 없습니다.'}
                      </p>
                    </div>
                    <Button onClick={runImport} disabled={!MES_COMMIT_ENABLED || s.insert.length === 0 || !!progress}>
                      {progress ? <Loader2 className="animate-spin" /> : <ClipboardCheck />}
                      {progress ? `등록 중… ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}` : `생산 실적 ${s.insertQty.toLocaleString()}조 등록`}
                    </Button>
                  </div>
                  {progress && (
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                    </div>
                  )}
                  {!MES_COMMIT_ENABLED && (
                    <p className="flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning-50 px-3.5 py-2.5 text-sm font-medium">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      시험 단계입니다. 미리보기만 할 수 있으며, 생산 실적 등록은 잠겨 있습니다.
                    </p>
                  )}
                  <ul className="space-y-1 rounded-lg bg-muted/50 px-3.5 py-2.5 text-xs text-muted-foreground">
                    <li className="flex gap-1.5"><Info className="mt-px h-3.5 w-3.5 shrink-0" />주간 · 야간은 바코드를 찍은 시각으로 나눕니다. <b className="text-foreground">18:00부터 야간</b>입니다(석식 17:30–18:00에 찍힌 것은 주간).</li>
                    <li className="flex gap-1.5"><Info className="mt-px h-3.5 w-3.5 shrink-0" />같은 품목 · 같은 날 · 같은 호기에 이미 입력된 수량은 빼고 부족한 만큼만 등록합니다. 같은 파일을 다시 올려도 중복 등록되지 않습니다.</li>
                    <li className="flex gap-1.5"><Info className="mt-px h-3.5 w-3.5 shrink-0" />의뢰 수량을 넘는 바코드(재작업 등)와 규격이 다른 품목은 등록하지 않고 &lsquo;확인 필요&rsquo;에 표시합니다.</li>
                  </ul>
                  {result && (
                    <p className="flex flex-wrap items-center gap-1.5 rounded-lg bg-success-50 px-3 py-2 text-sm font-medium text-success">
                      <CheckCircle2 className="h-4 w-4" />
                      생산 실적 {result.inserted.toLocaleString()}건({result.quantity.toLocaleString()}조)을 등록했습니다 — 의뢰서 {result.orders}건 · 품목 {result.items}줄.
                      <Link href="/production/report" className="ml-1 underline">생산일지 보기</Link>
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* 6. 목록 — 카드 맨 위 탭 */}
              <Card className="gap-0 py-0">
                <div role="tablist" aria-label="보기" className="flex gap-1 overflow-x-auto rounded-t-xl border-b bg-muted/30 px-2 sm:px-4">
                  <ViewTab active={tab === 'insert'} onClick={() => { setTab('insert'); setShowAll(false); }} label="등록할 실적" count={s.insert.length} />
                  <ViewTab active={tab === 'missing'} onClick={() => { setTab('missing'); setShowAll(false); }} label="의뢰서 미등록" count={s.missing.length} />
                  <ViewTab active={tab === 'review'} onClick={() => { setTab('review'); setShowAll(false); }} label="확인 필요" count={s.review.length} />
                  <ViewTab active={tab === 'done'} onClick={() => { setTab('done'); setShowAll(false); }} label="이미 등록됨" count={s.done.length} />
                </div>

                {tab === 'missing' && s.missing.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3 text-sm">
                    <p className="break-keep text-muted-foreground">아래 작업의뢰서가 시스템에 없습니다. ERP 작업의뢰서 목록으로 먼저 등록하면 다시 업로드할 때 함께 등록됩니다.</p>
                    <Link href="/work-orders/receive/import" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                      <FileSearch />지난 작업의뢰서 가져오기
                    </Link>
                  </div>
                )}

                <CardContent className="overflow-x-auto p-0">
                  {tabCount === 0 ? (
                    <p className="px-5 py-12 text-center text-sm text-muted-foreground">해당하는 항목이 없습니다.</p>
                  ) : tab === 'missing' ? (
                    <Table className="min-w-[760px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-5">의뢰번호</TableHead>
                          <TableHead>거래처 · 현장</TableHead>
                          <TableHead className="text-right">품목</TableHead>
                          <TableHead className="text-right">바코드</TableHead>
                          <TableHead className="pr-5">생산일</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(showAll ? s.missing : s.missing.slice(0, PREVIEW_ROWS)).map(m => (
                          <TableRow key={m.wo}>
                            <TableCell className="pl-5 font-bold text-brand-800">{m.wo}</TableCell>
                            <TableCell className="max-w-80">
                              <p className="truncate text-sm font-medium">{m.customer || '-'}</p>
                              <p className="truncate text-xs text-muted-foreground">{m.site}</p>
                            </TableCell>
                            <TableCell className="tabular text-right">{m.items.size}</TableCell>
                            <TableCell className="tabular text-right font-semibold">{m.count.toLocaleString()}장</TableCell>
                            <TableCell className="tabular pr-5 text-sm">{m.first === m.last ? m.first : `${m.first} – ${m.last.slice(5)}`}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <Table className="min-w-[980px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-5">생산일</TableHead>
                          <TableHead>호기</TableHead>
                          <TableHead>의뢰번호</TableHead>
                          <TableHead className="text-right">NO</TableHead>
                          <TableHead>품명 · 규격</TableHead>
                          <TableHead className="text-right">바코드</TableHead>
                          <TableHead className="text-right">{tab === 'done' ? '등록된 수량' : '등록 수량'}</TableHead>
                          <TableHead className="pr-5">{tab === 'insert' ? '현장 · 비고' : '사유'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(showAll ? tabRows : tabRows.slice(0, PREVIEW_ROWS)).map(r => (
                          <PlanRow key={`${r.wo}|${r.no}|${r.date}|${r.line}|${r.shift}`} r={r} tab={tab}
                            lineLabel={`${r.line ? lineName(lines, r.line) : '알 수 없음'} · ${SHIFT_TEXT[r.shift]}`} />
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {!showAll && tabCount > PREVIEW_ROWS && (
                    <button type="button" onClick={() => setShowAll(true)}
                      className="w-full border-t py-3 text-sm font-medium text-muted-foreground hover:bg-muted/50">
                      나머지 {(tabCount - PREVIEW_ROWS).toLocaleString()}건 더 보기
                    </button>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function reason(r: MesPlanRow): string {
  switch (r.status) {
    case 'over': return `의뢰 ${r.itemQuantity}조가 이미 모두 입력됨`;
    case 'partial': return `의뢰 ${r.itemQuantity}조까지 ${r.add}조만 등록, ${r.count - r.already - r.add}장 초과`;
    case 'no-item': return '';
    case 'size': return `시스템 품목은 ${r.itemWidth} × ${r.itemHeight}`;
    case 'line': return '';
    case 'done': return r.already > r.count ? `시스템 입력(${r.already}조)이 바코드보다 많음` : '';
    default: return '';
  }
}

function PlanRow({ r, tab, lineLabel }: { r: MesPlanRow; tab: Tab; lineLabel: string }) {
  const qty = tab === 'done' ? r.already : r.add;
  return (
    <TableRow>
      <TableCell className="tabular pl-5 text-sm">{r.date}</TableCell>
      <TableCell className="text-sm">{lineLabel}</TableCell>
      <TableCell className="font-bold text-brand-800">
        {r.workOrderId ? <Link href={`/production/${r.workOrderId}`} className="hover:underline">{r.wo}</Link> : r.wo}
        {r.outsource && <span className="ml-1.5 rounded bg-warning-50 px-1.5 py-0.5 text-[11px] font-semibold text-foreground">외주 지정</span>}
      </TableCell>
      <TableCell className="tabular text-right">{r.no}</TableCell>
      <TableCell className="max-w-72">
        <p className="truncate text-sm font-medium" title={r.itemProduct || r.product}>{r.itemProduct || r.product || '-'}</p>
        <p className="tabular text-xs text-muted-foreground">{r.width} × {r.height}</p>
      </TableCell>
      <TableCell className="tabular text-right">{r.count.toLocaleString()}</TableCell>
      <TableCell className={cn('tabular text-right font-semibold', tab === 'insert' && 'text-brand-800')}>
        {qty > 0 ? `${qty.toLocaleString()}조` : '-'}
      </TableCell>
      <TableCell className="max-w-72 pr-5 text-xs">
        {tab === 'insert' ? (
          <>
            <p className="truncate text-muted-foreground" title={r.site}>{r.site}</p>
            {r.remark && <p className="truncate text-muted-foreground/80" title={r.remark}>{r.remark}</p>}
          </>
        ) : (
          <span className={cn('inline-flex items-start gap-1', tab === 'review' && 'font-medium text-foreground')}>
            {tab === 'review' && <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />}
            <span><b>{STATUS_TEXT[r.status]}</b>{reason(r) && ` · ${reason(r)}`}</span>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function Stat({ label, value, sub, strong, warn }: { label: string; value: string; sub?: string; strong?: boolean; warn?: boolean }) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-5">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <p className={cn('tabular mt-1.5 text-2xl font-bold tracking-tight', strong && 'text-brand-800')}>{value}</p>
        {sub && <p className={cn('mt-1 break-keep text-xs', warn ? 'font-medium text-foreground' : 'text-muted-foreground')}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}</span>;
}

function ViewTab({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={cn('relative flex shrink-0 items-center gap-2 px-3 py-3.5 text-[15px] font-semibold transition-colors',
        active ? 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-full after:bg-brand-800'
          : 'text-muted-foreground hover:text-foreground')}>
      {label}
      <span className={cn('tabular rounded-full px-2 py-0.5 text-xs font-semibold', active ? 'bg-brand-50 text-brand-800' : 'bg-muted text-muted-foreground')}>
        {count.toLocaleString()}
      </span>
    </button>
  );
}

function DayTip({ active, payload }: { active?: boolean; payload?: { payload: { date: string; weekly: boolean; insert: number; done: number; blocked: number } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const total = d.insert + d.done + d.blocked;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold">{d.weekly ? `${d.date} 주` : d.date} · 바코드 {total.toLocaleString()}장</p>
      <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: C_INSERT }} />등록할 실적 {d.insert.toLocaleString()}</p>
      <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: C_DONE }} />이미 등록됨 {d.done.toLocaleString()}</p>
      <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: C_BLOCKED }} />등록 불가 {d.blocked.toLocaleString()}</p>
    </div>
  );
}
