'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Segmented from '@/components/ui/segmented';
import BokcheungLog from '@/components/production/BokcheungLog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/layout/PageHeader';
import { chipClass } from '@/components/ui/chip';
import Link from 'next/link';
import { Download, Loader2, CalendarDays, ChevronRight } from 'lucide-react';
import type { DailyReport } from '@/lib/production/daily-report';
import { readDraftsBetween } from '@/lib/production/bokcheung-drafts';
import { lineName } from '@/lib/production/lines';
import { useProductionLines } from '@/components/production/useProductionLines';

/** 브라우저(한국 시간) 기준 'YYYY-MM-DD' */
function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shift(d: Date, days: number) {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}

/** 자주 뽑는 기간 — 월요일 시작 주 */
function presets(): { key: string; label: string; from: string; to: string }[] {
  const today = new Date();
  const monday = shift(today, -((today.getDay() + 6) % 7));
  return [
    { key: 'today', label: '오늘', from: ymd(today), to: ymd(today) },
    { key: 'yesterday', label: '어제', from: ymd(shift(today, -1)), to: ymd(shift(today, -1)) },
    { key: 'week', label: '이번 주', from: ymd(monday), to: ymd(today) },
    { key: 'lastweek', label: '지난 주', from: ymd(shift(monday, -7)), to: ymd(shift(monday, -1)) },
    { key: 'month', label: '이번 달', from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) },
    { key: 'lastmonth', label: '지난 달',
      from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)) },
  ];
}

/**
 * 생산일지 — 두 보기.
 *  · 복층생산일지 (기본): 회사 양식 그대로의 하루치. 종류 · 수량외만 입력 (2026-10-30 요청)
 *  · 기간 합계: 기간을 골라 날짜별로 무엇을 몇 장 만들었나 (예전 일간 생산일지)
 */
export default function ProductionLogPage() {
  const router = useRouter();
  const view = useSearchParams().get('view') === 'period' ? 'period' : 'bokcheung';
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        back={{ href: '/production', label: '생산 현황' }}
        title="생산일지"
        description={view === 'bokcheung'
          ? '회사 복층생산일지 양식 그대로입니다. 종류와 수량외만 입력하면 엑셀로 내려받을 수 있습니다.'
          : '기간을 고르면 날짜마다 복층생산일지 시트가 한 장씩 든 엑셀로 내려받습니다. 아래는 그 기간에 생산한 내역입니다.'}
      />
      <Segmented value={view}
        onChange={v => router.replace(v === 'period' ? '/production/report?view=period' : '/production/report')}
        options={[{ value: 'bokcheung', label: '복층생산일지' }, { value: 'period', label: '기간 합계' }]} />
      {view === 'bokcheung' ? <BokcheungLog /> : <PeriodReport />}
    </div>
  );
}

function PeriodReport() {
  const [range, setRange] = useState(() => {
    const week = presets().find(p => p.key === 'week')!;
    return { from: week.from, to: week.to };
  });
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const { lines } = useProductionLines();

  const query = `from=${range.from}&to=${range.to}`;

  const load = useCallback(async () => {
    if (!range.from || !range.to) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/production/report?${query}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || '불러오지 못했습니다.');
      setReport(body);
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [query, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  // 기간 엑셀 = 복층생산일지를 날짜마다 시트 한 장씩 (회사 파일처럼). 그 PC 에 적어 둔 종류 · 수량외도 함께 보낸다
  async function download() {
    setDownloading(true);
    setError('');
    try {
      const res = await fetch(`/api/production/bokcheung/range?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drafts: readDraftsBetween(range.from, range.to) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '엑셀을 만들지 못했습니다.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = range.from === range.to
        ? `복층생산일지_${range.from}.xlsx`
        : `복층생산일지_${range.from}_${range.to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '엑셀을 만들지 못했습니다.');
    } finally {
      setDownloading(false);
    }
  }

  const activePreset = presets().find(p => p.from === range.from && p.to === range.to)?.key;
  const empty = report && report.days.length === 0;

  return (
    <div className="space-y-5">
      {/* 기간 */}
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {presets().map(p => (
                <button key={p.key} type="button" onClick={() => setRange({ from: p.from, to: p.to })}
                  className={chipClass(activePreset === p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            <Button onClick={download} disabled={downloading || loading || !report || !!empty}>
              {downloading ? <Loader2 className="animate-spin" /> : <Download />}
              {downloading ? '엑셀 만드는 중…' : '복층생산일지 엑셀 · 날짜별 시트'}
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5">
              <span className="block text-[13px] font-semibold">시작일</span>
              <Input type="date" className="w-44" value={range.from} max={range.to}
                onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
            </label>
            <span className="pb-2.5 text-muted-foreground">~</span>
            <label className="space-y-1.5">
              <span className="block text-[13px] font-semibold">종료일</span>
              <Input type="date" className="w-44" value={range.to} min={range.from}
                onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
            </label>
            {loading && (
              <span className="flex items-center gap-1.5 pb-2.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />불러오는 중…
              </span>
            )}
          </div>
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {report && (
        <>
          {/* 기간 요약 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="생산 수량" value={report.quantity.toLocaleString()} unit="장" />
            <Stat label="생산 면적" value={report.area_m2.toFixed(2)} unit="㎡" />
            <Stat label="생산한 날" value={String(report.days.length)} unit="일" />
          </div>

          {empty ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card py-12 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground" />
              <p className="font-semibold">이 기간에 입력된 생산실적이 없습니다</p>
              <p className="text-sm text-muted-foreground">기간을 바꿔 보세요.</p>
            </div>
          ) : (
            // 최근 날짜가 위로
            [...report.days].reverse().map(day => (
              <Card key={day.date} className="gap-0 py-0">
                <CardHeader className="flex flex-col gap-2 border-b bg-brand-50/60 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-lg">
                    {day.date} <span className={day.weekday === '일' ? 'text-destructive' : day.weekday === '토' ? 'text-brand-600' : 'text-muted-foreground'}>({day.weekday})</span>
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <b className="tabular text-base text-brand-800">{day.quantity.toLocaleString()}장</b>
                    <span className="tabular text-muted-foreground">· {day.area_m2.toFixed(2)}㎡ · 작업의뢰서 {day.work_order_count}건</span>
                    {day.night_quantity > 0 && <Badge variant="secondary">야간 {day.night_quantity}장</Badge>}
                    {/* 그날 복층생산일지의 종류 · 수량외를 채우러 */}
                    <Link href={`/production/report?date=${day.date}`}
                      className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 font-semibold text-brand-800 hover:bg-brand-50">
                      복층생산일지 입력<ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-5">의뢰번호</TableHead>
                        <TableHead>거래처 · 현장</TableHead>
                        <TableHead>품명</TableHead>
                        <TableHead className="text-right">규격 (mm)</TableHead>
                        <TableHead className="text-right">수량</TableHead>
                        <TableHead className="text-right">면적(㎡)</TableHead>
                        <TableHead>주/야 · 호기</TableHead>
                        <TableHead className="pr-5">입력자</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {day.lines.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-5 font-bold text-brand-800">{l.work_order_number}</TableCell>
                          <TableCell className="max-w-56 truncate">
                            {l.customer}<span className="text-muted-foreground"> · {l.site}</span>
                          </TableCell>
                          <TableCell className="font-semibold">{l.product_name}</TableCell>
                          <TableCell className="tabular text-right">
                            {l.width_mm && l.height_mm ? `${l.width_mm} × ${l.height_mm}` : '-'}
                          </TableCell>
                          <TableCell className="tabular text-right font-bold">{l.quantity}</TableCell>
                          <TableCell className="tabular text-right">{l.area_m2.toFixed(2)}</TableCell>
                          <TableCell className="text-sm">{l.shift === 'night' ? '야간' : '주간'} · {lineName(lines, l.line_number)}</TableCell>
                          <TableCell className="pr-5 text-sm text-muted-foreground">{l.workers.join(', ') || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className="tabular mt-1 text-2xl font-bold tracking-tight">
          {value}<span className="ml-1 text-sm font-medium text-muted-foreground">{unit}</span>
        </p>
      </CardContent>
    </Card>
  );
}
