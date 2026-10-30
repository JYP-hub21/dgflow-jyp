'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { readDraft, writeDraft } from '@/lib/production/bokcheung-drafts';
import { isIsoDate } from '@/lib/production/daily-report';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { chipClass } from '@/components/ui/chip';
import { CalendarDays, CalendarRange, Check, ChevronLeft, ChevronRight, CloudOff, Download, Loader2, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  GLASS_TYPES, JAE_PER_M2, SUMMARY_COLUMNS, summarizeTypes,
  type BokcheungBlock, type BokcheungEntry, type BokcheungSheet,
} from '@/lib/production/bokcheung';

/**
 * 복층생산일지 — 회사 양식 그대로의 하루치. 사람이 입력하는 칸은 종류 · 수량외 둘뿐이다.
 * 입력은 바로 저장한다(서버 표가 없으면 이 PC 에 임시 저장). 엑셀은 화면에 보이는 값으로 만든다.
 */

interface Loaded {
  sheet: BokcheungSheet;
  storage: 'db' | 'none';
  entries: Record<string, BokcheungEntry>;
  suggestions: Record<string, string>;
  canEdit: boolean;
}
type SaveState = 'idle' | 'saving' | 'saved' | 'local' | 'error';

const EMPTY: BokcheungEntry = { glass_type: '', quantity_note: '' };

/** 한국 시간 오늘 'YYYY-MM-DD' */
function todayKst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
const jae = (m2: number) => (m2 * JAE_PER_M2).toFixed(2);

export default function BokcheungLog() {
  const router = useRouter();
  const urlDate = useSearchParams().get('date');
  // ?date= 로 열면 그날 (기간 합계 화면의 '이 날 입력하기' 링크), 아니면 오늘
  const [date, setDateState] = useState(() => (isIsoDate(urlDate) ? urlDate : todayKst()));
  const setDate = useCallback((d: string) => {
    setDateState(d);
    router.replace(`/production/report?date=${d}`, { scroll: false });
  }, [router]);
  const [data, setData] = useState<Loaded | null>(null);
  const [entries, setEntries] = useState<Record<string, BokcheungEntry>>({});
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

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSave('idle');
    try {
      const res = await fetch(`/api/production/bokcheung?date=${date}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || '불러오지 못했습니다.');
      const loaded = body as Loaded;
      // 저장된 값 > 이 PC 임시 저장 > 같은 재료로 예전에 적은 종류
      const draft = loaded.storage === 'none' ? readDraft(date) : {};
      const next: Record<string, BokcheungEntry> = {};
      for (const r of loaded.sheet.blocks.flatMap(b => b.rows)) {
        next[r.key] = loaded.entries[r.key] ?? draft[r.key]
          ?? { glass_type: loaded.suggestions[r.key] ?? '', quantity_note: '' };
      }
      setEntries(next);
      setData(loaded);
      if (loaded.storage === 'none') setSave('local');
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => data?.sheet.blocks.flatMap(b => b.rows) ?? [], [data]);

  const flush = useCallback(async () => {
    const d = dataRef.current;
    const keys = [...pending.current];
    pending.current.clear();
    if (!d || keys.length === 0) return;
    if (d.storage !== 'db') { setSave('local'); return; }
    const byKey = new Map(d.sheet.blocks.flatMap(b => b.rows).map(r => [r.key, r]));
    const list = keys.flatMap(k => {
      const r = byKey.get(k);
      const e = entriesRef.current[k] ?? EMPTY;
      return r ? [{ line: r.line, work_order_id: r.work_order_id, composition: r.composition, ...e }] : [];
    });
    setSave('saving');
    try {
      const res = await fetch('/api/production/bokcheung/entries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: d.sheet.date, entries: list }),
      });
      if (res.status === 503) {
        setData(prev => prev && { ...prev, storage: 'none' });
        setSave('local');
        return;
      }
      setSave(res.ok ? 'saved' : 'error');
    } catch {
      setSave('error');
    }
  }, []);

  function change(keys: string[], patch: (e: BokcheungEntry, key: string) => BokcheungEntry) {
    setEntries(prev => {
      const next = { ...prev };
      for (const k of keys) next[k] = patch(prev[k] ?? EMPTY, k);
      writeDraft(date, next);
      return next;
    });
    keys.forEach(k => pending.current.add(k));
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  }

  // 날짜를 바꾸거나 화면을 떠나기 전에 남은 저장을 보낸다
  useEffect(() => () => { clearTimeout(timer.current); void flush(); }, [date, flush]);

  function fillSuggestions() {
    const empty = rows.filter(r => !(entries[r.key]?.quantity_note ?? '').trim()).map(r => r.key);
    if (empty.length === 0) return;
    const byKey = new Map(rows.map(r => [r.key, r]));
    change(empty, (e, k) => ({ ...e, quantity_note: byKey.get(k)?.suggested_note ?? '' }));
  }

  async function download() {
    if (!data) return;
    setDownloading(true);
    setError('');
    try {
      const res = await fetch(`/api/production/bokcheung?date=${data.sheet.date}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '엑셀을 만들지 못했습니다.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `복층생산일지_${data.sheet.date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '엑셀을 만들지 못했습니다.');
    } finally {
      setDownloading(false);
    }
  }

  const sheet = data?.sheet;
  const summary = sheet ? summarizeTypes(sheet, entries) : null;
  const missingType = rows.filter(r => !(entries[r.key]?.glass_type ?? '').trim()).length;
  const missingNote = rows.filter(r => !(entries[r.key]?.quantity_note ?? '').trim()).length;
  const canEdit = !!data?.canEdit;
  const today = todayKst();

  return (
    <div className="space-y-4">
      {/* 날짜 · 저장 상태 · 내려받기 */}
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <button type="button" className={chipClass(date === today)} onClick={() => setDate(today)}>오늘</button>
            <button type="button" className={chipClass(date === addDays(today, -1))} onClick={() => setDate(addDays(today, -1))}>어제</button>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label="하루 앞" onClick={() => setDate(addDays(date, -1))}><ChevronLeft /></Button>
              <Input type="date" className="w-44" value={date} onChange={e => e.target.value && setDate(e.target.value)} />
              <Button variant="outline" size="icon" aria-label="하루 뒤" onClick={() => setDate(addDays(date, 1))}><ChevronRight /></Button>
            </div>
            <span className={cn('pb-2 text-sm font-semibold', weekday(date) === '일' ? 'text-destructive' : 'text-muted-foreground')}>
              {weekday(date)}요일
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SaveBadge state={save} canEdit={canEdit} />
            {canEdit && (
              <Button variant="outline" onClick={fillSuggestions} disabled={!sheet || missingNote === 0}>
                <Wand2 />수량외 제안값 채우기
              </Button>
            )}
            <Button variant="outline" onClick={() => router.push('/production/report?view=period')}>
              <CalendarRange />기간으로 받기
            </Button>
            <Button onClick={download} disabled={!sheet || downloading || loading}>
              {downloading ? <Loader2 className="animate-spin" /> : <Download />}
              {downloading ? '엑셀 만드는 중…' : '이 날 엑셀'}
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

      {sheet && (
        <>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card py-12 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground" />
              <p className="font-semibold">{sheet.date} 에 입력된 복층 생산실적이 없습니다</p>
              <p className="text-sm text-muted-foreground">날짜를 바꿔 보세요. 빈 양식도 엑셀로 내려받을 수 있습니다.</p>
            </div>
          ) : (
            <p className="break-keep text-sm text-muted-foreground">
              <b className="text-foreground">종류</b>와 <b className="text-foreground">수량외</b>만 입력하면 회사 복층생산일지 양식 그대로 엑셀이 나옵니다.
              가로 · 세로는 그날 그 줄에서 작업의뢰서 순서가 가장 앞인 품목이고, 수량외 칸의 흐린 글씨는 그 품목 기준 제안값입니다.
              {missingType > 0 && <span className="font-semibold text-warning"> 종류가 빈 줄 {missingType}개</span>}
            </p>
          )}

          {sheet.blocks.map(block => (
            <BlockTable key={block.line} block={block} entries={entries} canEdit={canEdit}
              onChange={(key, field, value) => change([key], e => ({ ...e, [field]: value }))} />
          ))}

          {/* 종류별 합계 · 누계 — 엑셀 맨 아래와 같은 값 */}
          {summary && (
            <Card className="gap-0 py-0">
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {SUMMARY_COLUMNS.map(c => <TableHead key={c.label} className="text-center first:pl-5">{c.label}</TableHead>)}
                      <TableHead className="text-center">합계</TableHead>
                      <TableHead className="text-center">누계(수량)</TableHead>
                      <TableHead className="pr-5 text-center">누계(평)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="hover:bg-transparent">
                      {summary.counts.map((n, i) => <TableCell key={i} className="tabular text-center first:pl-5">{n}</TableCell>)}
                      <TableCell className="tabular text-center font-bold">{summary.total}</TableCell>
                      <TableCell className="tabular text-center">{sheet.cumulative.quantity.toLocaleString()}조</TableCell>
                      <TableCell className="tabular pr-5 text-center">{Number(jae(sheet.cumulative.area_m2)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          <p className="break-keep text-xs text-muted-foreground">
            합계는 종류 칸 값으로 셉니다 (회사 수식과 같이 B종(U3-2) 칸이 U3 를 셉니다). 종류가 빈 줄은 합계에 들어가지 않습니다.
            누계는 올해 1월 1일부터 이날까지 시스템에 입력된 복층 생산실적입니다.
            {sheet.excluded.quantity > 0 && ` 복층이 아닌 품목 ${sheet.excluded.quantity}장(${sheet.excluded.names.join(', ')})은 이 일지에서 뺐습니다.`}
          </p>
        </>
      )}

      <datalist id="glass-types">{GLASS_TYPES.map(t => <option key={t} value={t} />)}</datalist>
    </div>
  );
}

function SaveBadge({ state, canEdit }: { state: SaveState; canEdit: boolean }) {
  if (!canEdit) return <span className="text-xs text-muted-foreground">보기 전용 — 생산 입력 권한이 있어야 고칠 수 있습니다</span>;
  if (state === 'saving') return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />저장 중…</span>;
  if (state === 'saved') return <span className="flex items-center gap-1 text-xs font-medium text-success"><Check className="h-3.5 w-3.5" />저장됨</span>;
  if (state === 'local') return <span className="flex items-center gap-1 text-xs font-medium text-warning"><CloudOff className="h-3.5 w-3.5" />이 PC에 임시 저장</span>;
  if (state === 'error') return <span className="text-xs font-medium text-destructive">저장하지 못했습니다</span>;
  return null;
}

/** 한 호기 덩어리 — 엑셀과 같은 칸 순서 */
function BlockTable({ block, entries, canEdit, onChange }: {
  block: BokcheungBlock;
  entries: Record<string, BokcheungEntry>;
  canEdit: boolean;
  onChange: (key: string, field: keyof BokcheungEntry, value: string) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/40 px-5 py-3">
        <h3 className="text-[15px] font-bold">{block.name}</h3>
        <p className="tabular text-sm text-muted-foreground">
          {block.rows.length}줄 · <b className="text-foreground">{block.quantity}조</b> · {jae(block.area_m2)}평(재) · {block.area_m2.toFixed(2)}㎡
        </p>
      </div>
      <CardContent className="overflow-x-auto p-0">
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">주문번호</TableHead>
              <TableHead>거래처(발주자)</TableHead>
              <TableHead className="w-24">종류</TableHead>
              <TableHead>재료종류</TableHead>
              <TableHead className="text-right">두께</TableHead>
              <TableHead className="text-center">AR</TableHead>
              <TableHead className="text-right">가로</TableHead>
              <TableHead className="text-right">세로</TableHead>
              <TableHead className="w-32">수량외</TableHead>
              <TableHead className="text-right">수량(조)</TableHead>
              <TableHead className="pr-5 text-right">수량(평)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {block.rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={11} className="py-6 text-center text-sm text-muted-foreground">이 호기에서 생산한 기록이 없습니다.</TableCell>
              </TableRow>
            )}
            {block.rows.map(r => {
              const e = entries[r.key] ?? EMPTY;
              return (
                <TableRow key={r.key}>
                  <TableCell className="pl-5 font-bold text-brand-800">{r.continued ? '' : r.work_order_number}</TableCell>
                  <TableCell className="max-w-56 whitespace-normal break-keep text-sm">{r.continued ? '' : r.customer_site}</TableCell>
                  <TableCell>
                    <Input list="glass-types" value={e.glass_type} disabled={!canEdit} aria-label="종류"
                      onChange={ev => onChange(r.key, 'glass_type', ev.target.value)}
                      className={cn('h-9 w-20 font-semibold', !e.glass_type.trim() && canEdit && 'border-warning bg-warning-50')} />
                  </TableCell>
                  <TableCell className="whitespace-normal text-sm font-medium">{r.composition}</TableCell>
                  <TableCell className="tabular text-right">{r.thickness ?? '-'}</TableCell>
                  <TableCell className="text-center text-sm font-semibold">{r.argon ? 'AR' : ''}</TableCell>
                  <TableCell className="tabular text-right">{r.width_mm?.toLocaleString() ?? '-'}</TableCell>
                  <TableCell className="tabular text-right">{r.height_mm?.toLocaleString() ?? '-'}</TableCell>
                  <TableCell>
                    <Input value={e.quantity_note} placeholder={r.suggested_note} disabled={!canEdit} aria-label="수량외"
                      onChange={ev => onChange(r.key, 'quantity_note', ev.target.value)} className="h-9 w-28" />
                  </TableCell>
                  <TableCell className="tabular text-right font-bold">{r.quantity}조</TableCell>
                  <TableCell className="tabular pr-5 text-right">{jae(r.area_m2)}</TableCell>
                </TableRow>
              );
            })}
            {block.rows.length > 0 && (
              <TableRow className="bg-muted/40 font-bold hover:bg-muted/40">
                <TableCell className="pl-5" colSpan={9}>소계</TableCell>
                <TableCell className="tabular text-right">{block.quantity}조</TableCell>
                <TableCell className="tabular pr-5 text-right">{jae(block.area_m2)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
