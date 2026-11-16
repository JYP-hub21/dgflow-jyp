'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, ClipboardCheck, Database, FileSpreadsheet, Info, Loader2, Upload } from 'lucide-react';
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
import { MES_COMMIT_ENABLED, MAX_FILL_GAP, dailyTotals, groupPieces, groupQty, type MesParse } from '@/lib/production/mes';

/**
 * MES 생산실적 가져오기 (2026-11-13 이사님 요청, 2026-11-15 작업의뢰서 없이 넣는 방식).
 *
 * 11/13 회의 이사님: "MES 자료를 최대한 넣어 달라, 넣어 놓고 회사 주간생산일지와 비교해 진짜 빠진 것만 찾자".
 *  1) MES 생산실적 엑셀을 올린다 — 작업자 스레드에서 읽고, 아직 아무것도 저장하지 않는다
 *  2) 기간을 고른다 (처음엔 파일 전체)
 *  3) 날짜 · 호기 · 주야간별 장수를 본다 — 바코드 번호 사이 빈 장(첫 장 · 끝 장만 찍은 것)을 채운 수도 따로
 *  4) '등록' — MES 실적 표에 넣고, 일간 · 복층 · 주간 생산일지에 바로 반영된다. 같은 파일을 다시 올리면 덮어쓴다
 */
const PREVIEW_ROWS = 40;
const COMMIT_BATCH = 2000;
/** 작업의뢰서 만들기 — 의뢰번호 이만큼씩 */
const ORDER_BATCH = 60;

type Preset = '2w' | '3w' | '1m' | 'all' | 'custom';

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const weekday = (d: string) => WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()];

// 그래프 색 — 바코드로 찍힌 것(남색) · 번호 사이를 채운 것(옅은 남색)
const C_SCANNED = 'var(--brand-600)';
const C_FILLED = 'color-mix(in srgb, var(--brand-600) 35%, white)';

interface Stored { days: number; from: string | null; to: string | null; quantity: number; lastImport: { imported_at: string; source_file: string | null } | null; table: boolean }

export default function MesImportPage() {
  const { lines } = useProductionLines();
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [readRows, setReadRows] = useState(0);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<MesParse | null>(null);
  const [preset, setPreset] = useState<Preset>('all');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ saved: number; quantity: number; created: number; existing: number; logs: number } | null>(null);
  const [stored, setStored] = useState<Stored | null>(null);

  const loadStored = () => {
    fetch('/api/production/mes-import').then(r => r.json()).then(b => { if (!b.error) setStored(b as Stored); }).catch(() => {});
  };
  useEffect(loadStored, []);

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
      applyPreset('all', { min, max });
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 읽지 못했습니다.');
    } finally {
      setReading(false);
    }
  }

  const grouping = useMemo(
    () => (parsed && range ? groupPieces(parsed.pieces, range.from, range.to) : { groups: [], bigGaps: 0 }),
    [parsed, range],
  );
  const groups = grouping.groups;
  // 작업의뢰서는 통째로 — 기간을 골라도 그 기간에 생산한 의뢰서는 기간 앞의 생산까지 함께 넣는다(2026-11-16 '최근 3주' 시험).
  // 기간 안 것만 넣으면 기간 경계에 걸린 의뢰서의 수량이 반쪽이 된다. MES 실적 표(생산일지)는 기간 안 것만.
  const allGroups = useMemo(() => (parsed ? groupPieces(parsed.pieces).groups : []), [parsed]);
  const orderGroups = useMemo(() => {
    const wos = new Set(groups.map(g => g.wo));
    return allGroups.filter(g => wos.has(g.wo));
  }, [allGroups, groups]);
  const earlierQty = useMemo(() => orderGroups.filter(g => range && g.date < range.from).reduce((t, g) => t + groupQty(g), 0), [orderGroups, range]);
  const days = useMemo(() => dailyTotals(groups), [groups]);
  const usedLines = useMemo(() => [...new Set(groups.map(g => g.line))].sort((a, b) => a - b), [groups]);

  const s = useMemo(() => {
    const scanned = groups.reduce((t, g) => t + g.scanned, 0);
    const filled = groups.reduce((t, g) => t + g.filled, 0);
    return {
      scanned, filled, total: scanned + filled,
      orders: new Set(groups.map(g => g.wo)).size,
      items: new Set(groups.map(g => `${g.wo}|${g.no}`)).size,
      night: groups.filter(g => g.shift === 'night').reduce((t, g) => t + groupQty(g), 0),
    };
  }, [groups]);

  // 날짜별 — 쉰 날도 칸을 두어 흐름이 보이게. 두 달이 넘으면 주(월요일 시작)로 묶는다
  const chart = useMemo(() => {
    if (!range || days.length === 0) return [];
    const map = new Map(days.map(d => [d.date, d]));
    const span = daysBetween(range.from, range.to);
    const dates = Array.from({ length: span }, (_, i) => addDays(range.from, i));
    if (span <= 62) return dates.map(date => ({ date, label: shortDate(date), weekly: false, scanned: map.get(date)?.scanned ?? 0, filled: map.get(date)?.filled ?? 0 }));
    const weeks = new Map<string, { date: string; label: string; weekly: boolean; scanned: number; filled: number }>();
    for (const date of dates) {
      const monday = addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
      const w = weeks.get(monday) ?? { date: monday, label: shortDate(monday), weekly: true, scanned: 0, filled: 0 };
      const d = map.get(date);
      if (d) { w.scanned += d.scanned; w.filled += d.filled; }
      weeks.set(monday, w);
    }
    return [...weeks.values()];
  }, [days, range]);

  async function runImport() {
    if (groups.length === 0 || !range) return;
    if (!window.confirm(
      `${range.from} – ${range.to} MES 생산실적 ${s.total.toLocaleString()}조(바코드 ${s.scanned.toLocaleString()}장 + 번호 사이 ${s.filled.toLocaleString()}장)를 등록합니다.\n`
      + `의뢰번호 ${s.orders.toLocaleString()}건을 작업의뢰서(생산 완료)로 만들고 날짜별 생산 기록을 붙입니다. 이미 있는 의뢰서에는 빠진 생산 기록만 붙입니다.
`
      + (earlierQty > 0 ? `기간 앞에서 시작한 의뢰서는 의뢰서가 온전하도록 기간 앞의 생산 ${earlierQty.toLocaleString()}조도 함께 붙입니다.
` : '')
      + '계속하시겠습니까?',
    )) return;
    // 의뢰번호 단위 묶음 — 작업의뢰서 만들기용
    const byWo = new Map<string, typeof groups>();
    for (const g of orderGroups) { const l = byWo.get(g.wo); if (l) l.push(g); else byWo.set(g.wo, [g]); }
    const orderBatches: (typeof groups)[] = [];
    let cur: typeof groups = [], curWo = 0;
    for (const list of byWo.values()) {
      if (cur.length > 0 && (curWo >= ORDER_BATCH || cur.length + list.length > 7000)) { orderBatches.push(cur); cur = []; curWo = 0; }
      cur.push(...list); curWo++;
    }
    if (cur.length) orderBatches.push(cur);
    const steps = Math.ceil(groups.length / COMMIT_BATCH) + orderBatches.length;

    setProgress({ done: 0, total: steps });
    setError('');
    let saved = 0, quantity = 0, created = 0, existing = 0, logs = 0, step = 0;
    try {
      for (let i = 0; i < groups.length; i += COMMIT_BATCH) {
        const batch = groups.slice(i, i + COMMIT_BATCH);
        const res = await fetch('/api/production/mes-import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'commit', file: fileName, groups: batch }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || '등록하지 못했습니다.');
        saved += body.saved ?? 0;
        quantity += body.quantity ?? 0;
        setProgress({ done: ++step, total: steps });
      }
      // 작업의뢰서 + 생산 기록
      for (const batch of orderBatches) {
        const res = await fetch('/api/production/mes-import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'orders', groups: batch }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || '작업의뢰서를 만들지 못했습니다.');
        created += body.created ?? 0;
        existing += body.existing ?? 0;
        logs += body.logs ?? 0;
        setProgress({ done: ++step, total: steps });
      }
      setResult({ saved, quantity, created, existing, logs });
      toast.success(`작업의뢰서 ${created.toLocaleString()}건을 만들고 생산 실적 ${quantity.toLocaleString()}조를 등록했습니다.`);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : '등록하지 못했습니다.'} — 그때까지 들어간 것은 남아 있습니다. 다시 누르면 빠진 것만 이어서 넣습니다.`);
    } finally {
      setProgress(null);
      loadStored();
    }
  }

  const fileQty = useMemo(() => parsed?.pieces.reduce((t, p) => t + p.qty, 0) ?? 0, [parsed]);
  const shownDays = [...days].reverse();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        back={{ href: '/production', label: '생산 현황' }}
        title="MES 생산실적 가져오기"
        description="MES 에서 내려받은 생산실적 엑셀(포장공정 바코드)을 업로드하면 이미 생산이 끝난 작업의뢰서를 한꺼번에 만들고 날짜 · 호기별 생산 실적을 붙입니다. 작업의뢰서 목록 · 상세와 일간 · 복층 · 주간 생산일지에 바로 보입니다."
      />

      {stored && stored.days > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-border">
          <Database className="h-4 w-4 text-brand-800" />
          <span className="font-semibold">등록된 MES 실적</span>
          <span className="tabular text-muted-foreground">{stored.from} – {stored.to} · {stored.days}일 · {stored.quantity.toLocaleString()}조</span>
          {stored.lastImport && (
            <span className="text-xs text-muted-foreground sm:ml-auto">
              마지막 등록 {new Date(stored.lastImport.imported_at).toLocaleString('ko-KR')}{stored.lastImport.source_file ? ` · ${stored.lastImport.source_file}` : ''}
            </span>
          )}
        </div>
      )}

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
                {([['all', '파일 전체'], ['1m', '최근 한 달'], ['3w', '최근 3주'], ['2w', '최근 2주']] as const).map(([p, label]) => (
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

          {/* 3. 요약 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="등록할 생산 실적" value={`${s.total.toLocaleString()}조`} sub={`${range.from.slice(5)} – ${range.to.slice(5)} · ${days.length}일 생산`} strong />
            <Stat label="바코드로 찍힌 장수" value={`${s.scanned.toLocaleString()}장`} sub={`야간(18:00부터) ${s.night.toLocaleString()}조 포함`} />
            <Stat label="번호 사이를 채운 장수" value={`${s.filled.toLocaleString()}장`} sub="첫 장 · 끝 장만 찍힌 사이 장" />
            <Stat label="의뢰번호" value={`${s.orders.toLocaleString()}건`} sub={`품목 ${s.items.toLocaleString()}줄`} />
          </div>

          {/* 4. 날짜별 */}
          {chart.length > 0 && (
            <Card className="gap-0 py-0">
              <CardContent className="px-3 pb-2 pt-4 sm:px-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                  <p className="text-xs font-semibold text-muted-foreground">{chart[0]?.weekly ? '주별 생산 (월요일 시작, 조)' : '일별 생산 (조)'}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-foreground">
                    <Legend color={C_SCANNED} label="바코드로 찍힌 장수" />
                    <Legend color={C_FILLED} label="번호 사이를 채운 장수" />
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
                      <Bar dataKey="scanned" stackId="a" fill={C_SCANNED} maxBarSize={36} />
                      <Bar dataKey="filled" stackId="a" fill={C_FILLED} radius={chart.length > 40 ? 0 : [4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 5. 등록 */}
          <Card>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <p className="font-bold">생산 실적 등록</p>
                  <p className="mt-0.5 break-keep text-muted-foreground">
                    등록하면 의뢰번호 <b className="text-foreground">{s.orders.toLocaleString()}건</b>이 작업의뢰서(생산 완료)로 들어가고, <b className="text-foreground">{s.total.toLocaleString()}조</b>가 날짜별 생산 실적으로 붙어 작업의뢰서 상세 · 생산일지에 바로 보입니다.
                  </p>
                </div>
                <Button onClick={runImport} disabled={!MES_COMMIT_ENABLED || groups.length === 0 || !!progress}>
                  {progress ? <Loader2 className="animate-spin" /> : <ClipboardCheck />}
                  {progress ? `등록 중… ${Math.round(progress.done / progress.total * 100)}%` : `작업의뢰서 · 생산 실적 등록`}
                </Button>
              </div>
              {progress && (
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
              )}
              <ul className="space-y-1 rounded-lg bg-muted/50 px-3.5 py-2.5 text-xs text-muted-foreground">
                <li className="flex gap-1.5"><Info className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>같은 규격 여러 장은 첫 장 · 끝 장에만 바코드를 찍는 경우가 있습니다. 같은 품목의 <b className="text-foreground">바코드 번호 사이가 비면 그 장수를 채우고</b>, 뒤에 찍힌 장과 같은 날 · 호기에 생산한 것으로 봅니다({MAX_FILL_GAP}장 넘게 벌어지면 채우지 않습니다{grouping.bigGaps > 0 ? ` — 이 기간 ${grouping.bigGaps}곳` : ''}).</span></li>
                <li className="flex gap-1.5"><Info className="mt-px h-3.5 w-3.5 shrink-0" />주간 · 야간은 바코드를 찍은 시각으로 나눕니다. <b className="text-foreground">18:00부터 야간</b>입니다(석식 17:30–18:00에 찍힌 것은 주간).</li>
                <li className="flex gap-1.5"><Info className="mt-px h-3.5 w-3.5 shrink-0" />같은 파일을 다시 올리면 같은 날 · 호기 · 품목 값을 덮어씁니다. 두 번 세지 않습니다.</li>
                <li className="flex gap-1.5"><Info className="mt-px h-3.5 w-3.5 shrink-0" />작업의뢰서는 MES 의 의뢰번호 · 거래처 · 현장 · 품목(NO · 품명 · 규격 · 비고)으로 만들고, 수량은 MES 장수, 의뢰일은 첫 생산일, 상태는 완료입니다(납품은 기록하지 않습니다).</li>
                <li className="flex gap-1.5"><Info className="mt-px h-3.5 w-3.5 shrink-0" />이미 시스템에 있는 작업의뢰서는 새로 만들지 않고, 같은 NO 품목에 빠진 날짜의 생산 기록만 붙입니다.</li>
              </ul>
              {result && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-success-50 px-3 py-2 text-sm font-medium text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  작업의뢰서 {result.created.toLocaleString()}건을 새로 만들고{result.existing > 0 ? ` · 기존 ${result.existing}건에 기록을 붙이고` : ''}, 생산 기록 {result.logs.toLocaleString()}줄({result.quantity.toLocaleString()}조)을 등록했습니다.
                  <span className="ml-auto flex gap-1.5">
                    <Link href="/work-orders" className={buttonVariants({ variant: 'outline', size: 'sm' })}>작업의뢰서</Link>
                    <Link href="/production/report?view=bokcheung" className={buttonVariants({ variant: 'outline', size: 'sm' })}>복층생산일지</Link>
                    <Link href="/production/report?view=weekly" className={buttonVariants({ variant: 'outline', size: 'sm' })}>주간생산일지</Link>
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 6. 날짜별 표 */}
          <Card className="gap-0 py-0">
            <div className="border-b px-5 py-3.5">
              <p className="text-[15px] font-semibold">날짜별 생산 <span className="ml-1 text-xs font-normal text-muted-foreground">최근 날짜부터 · 조</span></p>
            </div>
            <CardContent className="overflow-x-auto p-0">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">날짜</TableHead>
                    {usedLines.map(l => (
                      <TableHead key={l} className="text-right">{l ? lineName(lines, l) : '호기 모름'}<span className="block text-[11px] font-normal">주간 · 야간</span></TableHead>
                    ))}
                    <TableHead className="text-right">바코드</TableHead>
                    <TableHead className="text-right">번호 사이</TableHead>
                    <TableHead className="pr-5 text-right">합계</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(showAll ? shownDays : shownDays.slice(0, PREVIEW_ROWS)).map(d => (
                    <TableRow key={d.date}>
                      <TableCell className="tabular pl-5 text-sm">{d.date} <span className="text-muted-foreground">({weekday(d.date)})</span></TableCell>
                      {usedLines.map(l => {
                        const c = d.lines[l];
                        return (
                          <TableCell key={l} className="tabular text-right text-sm">
                            {c ? <>{c.day.toLocaleString()}<span className="text-muted-foreground"> · {c.night.toLocaleString()}</span></> : <span className="text-muted-foreground">-</span>}
                          </TableCell>
                        );
                      })}
                      <TableCell className="tabular text-right text-sm">{d.scanned.toLocaleString()}</TableCell>
                      <TableCell className="tabular text-right text-sm text-muted-foreground">{d.filled ? `+${d.filled.toLocaleString()}` : '-'}</TableCell>
                      <TableCell className="tabular pr-5 text-right font-semibold">{(d.scanned + d.filled).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!showAll && shownDays.length > PREVIEW_ROWS && (
                <button type="button" onClick={() => setShowAll(true)}
                  className="w-full border-t py-3 text-sm font-medium text-muted-foreground hover:bg-muted/50">
                  나머지 {(shownDays.length - PREVIEW_ROWS).toLocaleString()}일 더 보기
                </button>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-5">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <p className={cn('tabular mt-1.5 text-2xl font-bold tracking-tight', strong && 'text-brand-800')}>{value}</p>
        {sub && <p className="mt-1 break-keep text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}</span>;
}

function DayTip({ active, payload }: { active?: boolean; payload?: { payload: { date: string; weekly: boolean; scanned: number; filled: number } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold">{d.weekly ? `${d.date} 주` : d.date} · {(d.scanned + d.filled).toLocaleString()}조</p>
      <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: C_SCANNED }} />바코드 {d.scanned.toLocaleString()}</p>
      <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: C_FILLED }} />번호 사이 {d.filled.toLocaleString()}</p>
    </div>
  );
}
