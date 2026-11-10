'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { readWeeklyDraft, writeWeeklyDraft } from '@/lib/production/weekly-drafts';
import { isIsoDate } from '@/lib/production/daily-report';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { chipClass } from '@/components/ui/chip';
import { Check, ChevronLeft, ChevronRight, CloudOff, Copy, Download, Loader2 } from 'lucide-react';
import { useProductionLines } from '@/components/production/useProductionLines';
import { activeLines, lineName } from '@/lib/production/lines';
import { cn } from '@/lib/utils';
import CrewPicker from '@/components/production/CrewPicker';
import type { CrewMember } from '@/lib/production/crew';
import {
  CREW_COLUMNS, DEFAULT_SETTINGS, EMPTY_DAY_ENTRY, SHIFT_TYPES, buildWeeklySheet, dayKey, weekOf, weeklyLineNumbers,
  type CrewKey, type WeekInfo, type WeeklyAuto, type WeeklyDayEntry, type WeeklyLineSheet, type WeeklyRow,
} from '@/lib/production/weekly';

/**
 * 주간생산일지 — 회사 양식 그대로의 한 주 (2026-11-06 요청).
 * 위 표는 양식과 같은 칸 순서로 근무 · 인원 · 사유를 적고, 생산조 · 생산M2 와 그 뒤 칸은 계산한다.
 * 아래 복층 · 3복층 칸이 위 표를 움직인다 — 엑셀 맨 아래 칸과 같다. 비워 두면 생산 기록 값을 쓴다.
 * 입력은 바로 저장한다(서버 표가 없으면 이 PC 에 임시 저장). 엑셀은 화면에 보이는 값으로 만든다.
 */

interface Loaded {
  week: WeekInfo;
  auto: WeeklyAuto;
  entries: Record<string, WeeklyDayEntry>;
  storage: 'db' | 'none';
  canEdit: boolean;
}
type SaveState = 'idle' | 'saving' | 'saved' | 'local' | 'error';

/** 한국 시간 오늘 'YYYY-MM-DD' */
function todayKst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const toNumber = (s: string): number | null => {
  const t = s.replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const fixed = (v: number | '휴무', digits: number) => (v === '휴무' ? v : v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const percent = (v: number) => `${Math.round(v * 100)}%`;
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 투입 인원 칸에서 고를 명단 — 표마다 넘기지 않고 한 곳에서 준다 */
interface CrewRoster {
  members: CrewMember[];
  /** 이 주에 적혀 있는 이름 (명단에 없는 사람 포함) */
  usedNames: string[];
  canAdd: boolean;
  add: (name: string) => Promise<void>;
}
const CrewContext = createContext<CrewRoster>({ members: [], usedNames: [], canAdd: false, add: async () => {} });

export default function WeeklyLog() {
  const router = useRouter();
  const urlDate = useSearchParams().get('date');
  const [date, setDateState] = useState(() => weekOf(isIsoDate(urlDate) ? urlDate : todayKst()).monday);
  const setDate = useCallback((d: string) => {
    const monday = weekOf(d).monday;
    setDateState(monday);
    router.replace(`/production/report?view=weekly&date=${monday}`, { scroll: false });
  }, [router]);
  const [data, setData] = useState<Loaded | null>(null);
  const [entries, setEntries] = useState<Record<string, WeeklyDayEntry>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [save, setSave] = useState<SaveState>('idle');
  const [downloading, setDownloading] = useState(false);

  // 디바운스 저장이 최신 값을 읽도록
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const dataRef = useRef(data);
  dataRef.current = data;
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 주를 빠르게 바꾸면 앞선 요청이 늦게 올 수 있다 — 마지막 요청의 결과만 쓴다
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError('');
    setSave('idle');
    try {
      const res = await fetch(`/api/production/weekly?date=${date}`);
      const body = await res.json();
      if (mine !== latest.current) return;
      if (!res.ok) throw new Error(body.error || '불러오지 못했습니다.');
      const loaded = body as Loaded;
      // 저장된 값 > 이 PC 임시 저장
      setEntries({ ...(loaded.storage === 'none' ? readWeeklyDraft(date) : {}), ...loaded.entries });
      setData(loaded);
      if (loaded.storage === 'none') setSave('local');
    } catch (e) {
      if (mine !== latest.current) return;
      setData(null);
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const flush = useCallback(async () => {
    const d = dataRef.current;
    const keys = [...pending.current];
    pending.current.clear();
    if (!d || keys.length === 0) return;
    if (d.storage !== 'db') { setSave('local'); return; }
    setSave('saving');
    try {
      const res = await fetch(`/api/production/weekly?date=${d.week.monday}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: Object.fromEntries(keys.map(k => [k, entriesRef.current[k] ?? EMPTY_DAY_ENTRY])) }),
      });
      if (res.status === 503) {
        setData(prev => prev && { ...prev, storage: 'none' });
        setSave('local');
        return;
      }
      if (res.ok) { setSave('saved'); return; }
      // 실패한 칸은 다음 저장 때 다시 보낸다 — 예전에는 대기 목록을 먼저 비워 그 PC 임시 저장에만 남았다 (2026-11-10 전체 점검)
      keys.forEach(k => pending.current.add(k));
      setSave('error');
    } catch {
      keys.forEach(k => pending.current.add(k));
      setSave('error');
    }
  }, []);

  const change = useCallback((key: string, patch: (e: WeeklyDayEntry) => WeeklyDayEntry) => {
    setEntries(prev => {
      const next = { ...prev, [key]: patch(prev[key] ?? EMPTY_DAY_ENTRY) };
      writeWeeklyDraft(date, next);
      return next;
    });
    pending.current.add(key);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  }, [date, flush]);

  // 주를 바꾸거나 화면을 떠나기 전에 남은 저장을 보낸다
  useEffect(() => () => { clearTimeout(timer.current); void flush(); }, [date, flush]);

  async function download() {
    if (!data) return;
    setDownloading(true);
    setError('');
    try {
      const res = await fetch(`/api/production/weekly?date=${data.week.monday}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '엑셀을 만들지 못했습니다.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `주간생산일지_${data.week.sheetName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '엑셀을 만들지 못했습니다.');
    } finally {
      setDownloading(false);
    }
  }

  const { lines } = useProductionLines();
  const sheet = useMemo(() => {
    if (!data) return null;
    const numbers = weeklyLineNumbers(activeLines(lines).map(l => l.line_number), entries, data.auto);
    return buildWeeklySheet(data.week.monday, entries, data.auto, DEFAULT_SETTINGS, numbers);
  }, [data, entries, lines]);
  const names = useMemo(() => {
    const all = Object.values(entries).flatMap(e => Object.values(e.crew ?? {}));
    return [...new Set(all.map(n => (n ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [entries]);
  // 생산 인원 명단 (조직도 생산부) — 표가 없으면 이 주에 적힌 이름으로만 고른다
  const [crew, setCrew] = useState<{ storage: 'db' | 'none'; members: CrewMember[] }>({ storage: 'none', members: [] });
  useEffect(() => {
    fetch('/api/production/crew').then(r => (r.ok ? r.json() : null))
      .then(j => { if (j) setCrew({ storage: j.storage, members: j.members ?? [] }); })
      .catch(() => {});
  }, []);
  const addCrew = useCallback(async (name: string) => {
    const res = await fetch('/api/production/crew', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? '명단에 추가하지 못했습니다.');
    setCrew(prev => ({ ...prev, members: [...prev.members.filter(m => m.id !== j.data.id), j.data] }));
  }, []);
  const roster = useMemo<CrewRoster>(() => ({
    members: crew.members, usedNames: names, canAdd: crew.storage === 'db' && !!data?.canEdit, add: addCrew,
  }), [crew, names, data?.canEdit, addCrew]);

  const canEdit = !!data?.canEdit;
  const thisMonday = weekOf(todayKst()).monday;
  const week = data?.week ?? weekOf(date);
  // 양식은 월–토라 일요일 생산은 칸이 없다 — 빠진다고 알린다
  const sundayDate = addDays(week.saturday, 1);
  const sundayJo = Object.values(data?.auto[sundayDate] ?? {}).reduce((s, c) => s + c.double.jo + c.triple.jo, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={chipClass(date === thisMonday)} onClick={() => setDate(thisMonday)}>이번 주</button>
            <button type="button" className={chipClass(date === addDays(thisMonday, -7))} onClick={() => setDate(addDays(thisMonday, -7))}>지난 주</button>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label="한 주 앞" onClick={() => setDate(addDays(date, -7))}><ChevronLeft /></Button>
              <Input type="date" className="w-44" value={date} onChange={e => e.target.value && setDate(e.target.value)} />
              <Button variant="outline" size="icon" aria-label="한 주 뒤" onClick={() => setDate(addDays(date, 7))}><ChevronRight /></Button>
            </div>
            <span className="text-sm font-semibold text-foreground">
              {week.year}년 {week.weekNumber}주차 ({week.month}월 {week.weekOfMonth}주)
              <span className="ml-1.5 font-medium text-muted-foreground">{shortDate(week.monday)}–{shortDate(week.saturday)}</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SaveBadge state={save} canEdit={canEdit} />
            <Button onClick={download} disabled={!sheet || downloading || loading}>
              {downloading ? <Loader2 className="animate-spin" /> : <Download />}
              {downloading ? '엑셀 생성 중…' : '엑셀 다운로드'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data?.storage === 'none' && canEdit && (
        <p className="break-keep rounded-lg border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm">
          입력값을 저장할 표가 아직 데이터베이스에 없어서, 지금은 <b>이 PC에만 임시로</b> 저장됩니다.
          엑셀은 지금 입력한 값으로 바로 만들 수 있습니다.
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive">{error}</p>
      )}
      {loading && !sheet && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중…</p>
      )}

      {sheet && data && (
        <>
          {sundayJo > 0 && (
            <p className="break-keep rounded-lg border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm">
              {shortDate(sundayDate)} 일요일 생산 {sundayJo.toLocaleString()}조는 주간생산일지 양식에 칸이 없어 이 표에 포함되지 않습니다.
            </p>
          )}
          {/* 복층 · 3복층 생산량을 맨 위에 (2026-11-09 사용자 요청) — 아래 호기별 표의 생산조 · 생산M² 가 여기서 온다 */}
          <OutputTable sheet={sheet.lines} nameOf={n => lineName(lines, n)} entries={entries} auto={data.auto} canEdit={canEdit} onChange={change} />

          <p className="break-keep text-sm text-muted-foreground">
            <b className="text-foreground">근무 구분 · 근무시간 · 투입 인원 · 사유</b>를 입력하면 목표 · 시간당 생산 · 환산 · 평가가 계산되고, 회사 주간생산일지 양식 그대로 엑셀이 나옵니다.
            근무시간은 설비 고장 같은 부동시간을 뺀 실제 생산 시간을 입력하세요. 투입 인원 칸을 누르면 생산부 명단에서 고를 수 있습니다.
          </p>

          <CrewContext.Provider value={roster}>
            {sheet.lines.map(block => (
              <LineTable key={block.line} block={block} name={lineName(lines, block.line)} entries={entries} canEdit={canEdit} auto={data.auto} onChange={change} />
            ))}
          </CrewContext.Provider>
        </>
      )}

    </div>
  );
}

function SaveBadge({ state, canEdit }: { state: SaveState; canEdit: boolean }) {
  if (!canEdit) return <span className="text-xs text-muted-foreground">보기 전용 — 생산 입력 권한이 있어야 수정할 수 있습니다</span>;
  if (state === 'saving') return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />저장 중…</span>;
  if (state === 'saved') return <span className="flex items-center gap-1 text-xs font-medium text-success"><Check className="h-3.5 w-3.5" />저장됨</span>;
  if (state === 'local') return <span className="flex items-center gap-1 text-xs font-medium text-warning"><CloudOff className="h-3.5 w-3.5" />이 PC에 임시 저장</span>;
  if (state === 'error') return <span className="text-xs font-medium text-destructive">저장하지 못했습니다</span>;
  return null;
}

const th = 'border border-border bg-muted/60 px-1.5 py-1.5 text-center text-xs font-semibold leading-tight text-foreground';
const td = 'border border-border px-1.5 py-1 text-center text-[13px] tabular';
const calc = cn(td, 'bg-muted/25');
const cellInput = 'h-8 w-full min-w-0 rounded-md border border-input bg-background px-1.5 text-center text-[13px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-70';

/** 한 호기 표 — 양식과 같은 칸 순서 */
function LineTable({ block, name, entries, canEdit, auto, onChange }: {
  block: WeeklyLineSheet;
  name: string;
  entries: Record<string, WeeklyDayEntry>;
  canEdit: boolean;
  auto: WeeklyAuto;
  onChange: (key: string, patch: (e: WeeklyDayEntry) => WeeklyDayEntry) => void;
}) {
  const t = block.totals;
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/40 px-5 py-3">
        <h3 className="text-[15px] font-bold">주간생산일지 {name}</h3>
        <p className="tabular text-sm text-muted-foreground">
          근무 {t.hours}시간 · <b className="text-foreground">{t.jo.toLocaleString()}조</b> · {fixed(t.m2, 2)}M² · 환산 {fixed(t.score, 1)}
        </p>
      </div>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-max min-w-full border-collapse">
          <thead>
            <tr>
              <th rowSpan={2} className={cn(th, 'sticky left-0 z-20 min-w-14')}>일</th>
              <th rowSpan={2} className={cn(th, 'sticky left-14 z-20 min-w-9')}>요일</th>
              <th rowSpan={2} className={cn(th, 'min-w-24')}>근무<br />구분</th>
              <th rowSpan={2} className={cn(th, 'min-w-16')}>근무<br />시간</th>
              <th rowSpan={2} className={cn(th, 'min-w-18')}>바코드 기준<br />생산량</th>
              <th rowSpan={2} className={cn(th, 'min-w-14')}>바코드<br />입력 비율</th>
              <th colSpan={CREW_COLUMNS.length + 1} className={th}>생산 투입 총 인원 — {name}</th>
              <th rowSpan={2} className={cn(th, 'min-w-14')}>목표<br />(조,M²)</th>
              <th colSpan={3} className={th}>생산조</th>
              <th colSpan={3} className={th}>생산M²</th>
              <th rowSpan={2} className={cn(th, 'min-w-12')}>환산<br />A</th>
              <th rowSpan={2} className={cn(th, 'min-w-12')}>환산<br />B</th>
              <th rowSpan={2} className={cn(th, 'min-w-12')}>환산<br />계</th>
              <th rowSpan={2} className={cn(th, 'min-w-16')}>평가</th>
              <th rowSpan={2} className={cn(th, 'min-w-72')}>사유</th>
            </tr>
            <tr>
              {CREW_COLUMNS.map(c => <th key={c.key} className={cn(th, 'min-w-20')}>{c.label}</th>)}
              <th className={cn(th, 'min-w-12')}>총계</th>
              <th className={cn(th, 'min-w-16')}>생산조</th>
              <th className={cn(th, 'min-w-14')}>시간당</th>
              <th className={cn(th, 'min-w-12')}>목표<br />대비</th>
              <th className={cn(th, 'min-w-20')}>생산M²</th>
              <th className={cn(th, 'min-w-14')}>시간당</th>
              <th className={cn(th, 'min-w-12')}>목표<br />대비</th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <DayRow key={row.date} row={row} line={block.line} entry={entries[dayKey(row.date, block.line)] ?? EMPTY_DAY_ENTRY}
                prevCrew={i > 0 ? entries[dayKey(block.rows[i - 1].date, block.line)]?.crew : undefined}
                produced={!!auto[row.date]?.[block.line]} canEdit={canEdit} onChange={onChange} />
            ))}
            <tr className="bg-muted/40 font-bold">
              <td colSpan={2} className={cn(td, 'sticky left-0 z-10 bg-muted')}>소계</td>
              <td className={td} />
              <td className={td}>{t.hours}</td>
              <td colSpan={2 + CREW_COLUMNS.length + 1} className={td} />
              <td className={td}>{t.target.toLocaleString()}</td>
              <td className={td}>{t.jo.toLocaleString()}</td>
              <td className={td}>{fixed(t.joPerHour, 2)}</td>
              <td className={td}>{percent(t.joRate)}</td>
              <td className={td}>{fixed(t.m2, 2)}</td>
              <td className={td}>{fixed(t.m2PerHour, 2)}</td>
              <td className={td}>{percent(t.m2Rate)}</td>
              <td className={td}>{fixed(t.scoreA, 2)}</td>
              <td className={td}>{fixed(t.scoreB, 2)}</td>
              <td className={td}>{fixed(t.score, 1)}</td>
              <td className={td}><Grade grade={t.grade} /></td>
              <td className={td} />
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Grade({ grade }: { grade: string }) {
  const label = grade.trim();
  return <span className={cn('whitespace-nowrap font-semibold', label.startsWith('사유') && 'text-warning', label === '좋아요' && 'text-success')}>{label}</span>;
}

function DayRow({ row, line, entry, prevCrew, produced, canEdit, onChange }: {
  row: WeeklyRow;
  line: number;
  entry: WeeklyDayEntry;
  prevCrew: WeeklyDayEntry['crew'] | undefined;
  /** 이날 이 호기 생산 기록이 있나 — 있는데 근무시간이 비면 알린다 */
  produced: boolean;
  canEdit: boolean;
  onChange: (key: string, patch: (e: WeeklyDayEntry) => WeeklyDayEntry) => void;
}) {
  const key = dayKey(row.date, line);
  const crew = entry.crew ?? {};
  const setCrew = (k: CrewKey, v: string) => onChange(key, e => ({ ...e, crew: { ...e.crew, [k]: v } }));
  const copyable = canEdit && !!prevCrew && Object.values(prevCrew).some(Boolean);
  const roster = useContext(CrewContext);
  const hoursMissing = produced && entry.work_hours === null;
  return (
    <tr>
      <td className={cn(td, 'sticky left-0 z-10 bg-card font-semibold')}>{shortDate(row.date)}</td>
      <td className={cn(td, 'sticky left-14 z-10 bg-card', row.weekday === '토' && 'text-brand-700')}>{row.weekday}</td>
      <td className={td}>
        <select aria-label="근무 구분" value={entry.shift_type} disabled={!canEdit} className={cellInput}
          onChange={e => {
            const value = e.target.value;
            const hours = SHIFT_TYPES.find(s => s.value === value)?.hours ?? null;
            onChange(key, p => ({ ...p, shift_type: value, work_hours: hours }));
          }}>
          <option value="" />
          {SHIFT_TYPES.map(s => <option key={s.value} value={s.value}>{s.value}</option>)}
          {entry.shift_type && !SHIFT_TYPES.some(s => s.value === entry.shift_type) && <option value={entry.shift_type}>{entry.shift_type}</option>}
        </select>
      </td>
      <td className={td}>
        <input aria-label="근무시간" type="number" min={0} step="0.01" inputMode="decimal" disabled={!canEdit}
          value={entry.work_hours ?? ''} className={cn(cellInput, '!w-16', hoursMissing && 'border-warning bg-warning-50')}
          onChange={e => onChange(key, p => ({ ...p, work_hours: toNumber(e.target.value) }))} />
      </td>
      <td className={td}>
        <input aria-label="바코드 기준 생산량" type="number" min={0} inputMode="numeric" disabled={!canEdit}
          value={entry.barcode_qty ?? ''} className={cn(cellInput, '!w-20')}
          onChange={e => onChange(key, p => ({ ...p, barcode_qty: toNumber(e.target.value) }))} />
      </td>
      <td className={calc}>{row.barcodeRatio === null ? '' : row.barcodeRatio.toFixed(1)}</td>
      {CREW_COLUMNS.map((c, i) => (
        <td key={c.key} className={cn(td, 'relative')}>
          <CrewPicker value={crew[c.key] ?? ''} label={c.label} members={roster.members} usedNames={roster.usedNames}
            canEdit={canEdit} canAdd={roster.canAdd} onChange={v => setCrew(c.key, v)} onAdd={roster.add} />
          {i === 0 && copyable && !Object.values(crew).some(Boolean) && (
            <button type="button" title="전날 인원과 동일하게 입력" aria-label="전날 인원과 동일하게 입력"
              className="absolute inset-y-1 right-2 flex items-center text-muted-foreground hover:text-primary"
              onClick={() => onChange(key, p => ({ ...p, crew: { ...prevCrew } }))}>
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}
        </td>
      ))}
      <td className={calc}>{row.crewTotal.toFixed(1)}</td>
      <td className={calc}>{row.target.toLocaleString()}</td>
      <td className={cn(calc, 'font-bold')}>{row.jo.toLocaleString()}</td>
      <td className={calc}>{fixed(row.joPerHour, 2)}</td>
      <td className={calc}>{percent(row.joRate)}</td>
      <td className={cn(calc, 'font-bold')}>{fixed(row.m2, 2)}</td>
      <td className={calc}>{fixed(row.m2PerHour, 2)}</td>
      <td className={calc}>{percent(row.m2Rate)}</td>
      <td className={calc}>{fixed(row.scoreA, 1)}</td>
      <td className={calc}>{fixed(row.scoreB, 1)}</td>
      <td className={calc}>{fixed(row.score, 1)}</td>
      <td className={calc}><Grade grade={row.grade} /></td>
      <td className={td}>
        <textarea aria-label="사유" rows={2} cols={1} disabled={!canEdit} value={entry.reason}
          className={cn(cellInput, 'h-auto min-h-8 resize-y py-1 text-left leading-snug')}
          onChange={e => onChange(key, p => ({ ...p, reason: e.target.value }))} />
      </td>
    </tr>
  );
}

const OUTPUT_FIELDS = [
  { field: 'double_jo', from: 'double', unit: 'jo', label: '조' },
  { field: 'double_m2', from: 'double', unit: 'm2', label: 'M²' },
  { field: 'triple_jo', from: 'triple', unit: 'jo', label: '조' },
  { field: 'triple_m2', from: 'triple', unit: 'm2', label: 'M²' },
] as const;

/** 엑셀 맨 아래 칸 — 날마다 복층 · 3복층. 화면에서는 맨 위에 둔다. 호기별 표의 생산조 · 생산M² 는 여기서 온다 */
function OutputTable({ sheet, nameOf, entries, auto, canEdit, onChange }: {
  sheet: WeeklyLineSheet[];
  nameOf: (line: number) => string;
  entries: Record<string, WeeklyDayEntry>;
  auto: WeeklyAuto;
  canEdit: boolean;
  onChange: (key: string, patch: (e: WeeklyDayEntry) => WeeklyDayEntry) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="border-b bg-muted/40 px-5 py-3">
        <h3 className="text-[15px] font-bold">복층 · 3복층 생산량</h3>
        <p className="mt-0.5 break-keep text-sm text-muted-foreground">
          엑셀 맨 아래 칸과 같습니다. 합계는 복층 + 3복층 × 2 이며, 아래 호기별 표의 생산조 · 생산M²로 들어갑니다.
          흐린 값은 생산 기록(유리 3장 이상을 3복층으로 구분)입니다. 스텝 · 이형처럼 200%로 인정할 수량은 3복층 칸으로 옮겨 입력하세요.
        </p>
      </div>
      <CardContent className="grid gap-5 overflow-x-auto p-4 xl:grid-cols-2">
        {sheet.map(block => (
          <table key={block.line} className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                <th rowSpan={2} className={cn(th, 'w-20')}>{nameOf(block.line)}</th>
                <th colSpan={2} className={th}>복층</th>
                <th colSpan={2} className={th}>3복층</th>
                <th colSpan={2} className={th}>합계</th>
              </tr>
              <tr>
                <th className={th}>조</th><th className={th}>M²</th><th className={th}>조</th><th className={th}>M²</th><th className={th}>조</th><th className={th}>M²</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map(row => {
                const key = dayKey(row.date, block.line);
                const e = entries[key] ?? EMPTY_DAY_ENTRY;
                const a = auto[row.date]?.[block.line];
                return (
                  <tr key={row.date}>
                    <td className={cn(td, 'font-semibold')}>{shortDate(row.date)} {row.weekday}</td>
                    {OUTPUT_FIELDS.map(f => (
                      <td key={f.field} className={td}>
                        <input aria-label={`${row.weekday} ${f.from === 'double' ? '복층' : '3복층'} ${f.label}`} type="number" min={0} step={f.unit === 'm2' ? '0.01' : '1'}
                          inputMode="decimal" disabled={!canEdit} value={e[f.field] ?? ''} placeholder={String(a?.[f.from][f.unit] ?? 0)}
                          className={cn(cellInput, '!w-20', e[f.field] !== null && 'font-semibold')}
                          onChange={ev => onChange(key, p => ({ ...p, [f.field]: toNumber(ev.target.value) }))} />
                      </td>
                    ))}
                    <td className={cn(calc, 'font-bold')}>{row.jo.toLocaleString()}</td>
                    <td className={cn(calc, 'font-bold')}>{fixed(row.m2, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </CardContent>
    </Card>
  );
}

