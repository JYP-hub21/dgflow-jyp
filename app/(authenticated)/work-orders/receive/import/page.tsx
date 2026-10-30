'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { readWorkbookFile } from '@/lib/excel/read-file';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  importPlan, parseErpOrderList, type ErpListOrder, type ErpListParse, type ImportOptions,
} from '@/lib/work-order/erp-list';

/**
 * 지난 작업의뢰서 한꺼번에 가져오기 — ERP 가 뽑아 준 작업의뢰서 목록 엑셀(한 줄 = 품목 하나).
 *
 * 앞으로는 의뢰서 한 장씩 엑셀 + PDF 로 등록하지만, 지난 것을 한 장씩 올리는 건 무리라서
 * ERP 목록 엑셀 하나를 읽어 의뢰번호별로 묶어 넣는다 (2026-10-30 요청).
 * 1) 파일을 고르면 브라우저에서 읽어 미리 보여 준다 — 아직 아무것도 저장하지 않는다
 * 2) 이미 등록된 의뢰번호를 확인해 건너뛸 것을 표시한다
 * 3) 출고 수량 · 잔여 의뢰서를 어떻게 넣을지 고른 뒤 '가져오기' — 나눠서 보낸다
 */
const BATCH = 40;
const PREVIEW_ROWS = 50;

export default function ImportWorkOrdersPage() {
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ErpListParse | null>(null);
  const [existing, setExisting] = useState<Set<string> | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [producedFromShipped, setProducedFromShipped] = useState(true);
  const [remainingStatus, setRemainingStatus] = useState<ImportOptions['remainingStatus'] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; items: number; skipped: number } | null>(null);

  async function onFile(file: File) {
    setReading(true);
    setError('');
    setParsed(null);
    setExisting(null);
    setResult(null);
    setFileName(file.name);
    try {
      const wb = await readWorkbookFile(file, { cellDates: true });
      // 의뢰번호 · 품명 머리가 있는 시트를 고른다 (없으면 첫 시트)
      let best: ErpListParse | null = null;
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true });
        const p = parseErpOrderList(rows);
        if (!best || p.itemCount > best.itemCount) best = p;
      }
      if (!best || best.headerRow === 0) throw new Error('의뢰번호 · 품명 칸이 있는 표를 찾지 못했습니다. ERP 작업의뢰서 목록 엑셀인지 확인해 주세요.');
      if (best.missingColumns.length > 0) throw new Error(`필요한 칸이 없습니다: ${best.missingColumns.join(', ')}`);
      if (best.orders.length === 0) throw new Error('가져올 작업의뢰서가 없습니다.');
      setParsed(best);
      const res = await fetch('/api/work-orders/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'check', numbers: best.orders.map(o => o.work_order_number) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || '등록 여부를 확인하지 못했습니다.');
      setExisting(new Set(body.existing as string[]));
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 읽지 못했습니다.');
    } finally {
      setReading(false);
    }
  }

  const fresh = useMemo(() => (parsed && existing ? parsed.orders.filter(o => !existing.has(o.work_order_number)) : []), [parsed, existing]);
  const options: ImportOptions | null = remainingStatus ? { producedFromShipped, remainingStatus } : null;
  const plan = useMemo(() => {
    if (!options) return null;
    const count = { pending: 0, in_progress: 0, completed: 0 };
    for (const o of fresh) count[importPlan(o, options).status]++;
    return count;
  }, [fresh, options?.producedFromShipped, options?.remainingStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const dates = parsed?.orders.map(o => o.request_date).filter(Boolean).sort() as string[] | undefined;
  const withRemaining = fresh.filter(o => o.remaining > 0).length;

  async function runImport() {
    if (!options || fresh.length === 0) return;
    if (!window.confirm(`새 작업의뢰서 ${fresh.length}건(품목 ${fresh.reduce((s, o) => s + o.items.length, 0)}줄)을 시스템에 넣습니다. 계속할까요?`)) return;
    setProgress({ done: 0, total: fresh.length });
    setError('');
    let created = 0, items = 0, skipped = 0;
    try {
      for (let i = 0; i < fresh.length; i += BATCH) {
        const batch = fresh.slice(i, i + BATCH);
        const res = await fetch('/api/work-orders/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'commit', orders: batch, options }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || '가져오지 못했습니다.');
        created += body.created ?? 0;
        items += body.items ?? 0;
        skipped += (body.skipped ?? []).length;
        setProgress({ done: Math.min(fresh.length, i + BATCH), total: fresh.length });
      }
      setResult({ created, items, skipped });
      setExisting(prev => new Set([...(prev ?? []), ...fresh.map(o => o.work_order_number)]));
      toast.success(`작업의뢰서 ${created}건을 가져왔습니다.`);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : '가져오지 못했습니다.'} — 그때까지 ${created}건은 들어갔습니다. 다시 누르면 들어간 것은 건너뜁니다.`);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        back={{ href: '/work-orders/receive', label: '작업의뢰서 등록' }}
        title="지난 작업의뢰서 가져오기"
        description="ERP 에서 뽑은 작업의뢰서 목록 엑셀(한 줄에 품목 하나)을 올리면 의뢰번호별로 묶어 한꺼번에 등록합니다. 파일을 고르면 먼저 미리 보여 주고, 확인한 뒤에 넣습니다."
      />

      {/* 1. 파일 */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-800"><FileSpreadsheet className="h-5 w-5" /></span>
            <div>
              <p className="font-semibold">{fileName || 'ERP 작업의뢰서 목록 엑셀'}</p>
              <p className="text-xs text-muted-foreground">xlsx · xls · csv — 의뢰번호 · 품명 · 가로규격 · 세로규격 · 주문수량 칸이 있어야 합니다</p>
            </div>
          </div>
          <label className={cn('inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand-800 px-4 text-sm font-semibold text-white hover:bg-brand-700', reading && 'pointer-events-none opacity-60')}>
            {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {reading ? '읽는 중…' : parsed ? '다른 파일 고르기' : '파일 고르기'}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
          </label>
        </CardContent>
      </Card>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive">{error}</p>}

      {parsed && (
        <>
          {/* 2. 미리보기 숫자 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="작업의뢰서" value={`${parsed.orders.length.toLocaleString()}건`} sub={`품목 ${parsed.itemCount.toLocaleString()}줄`} />
            <Stat label="주문일" value={dates?.length ? `${dates[0].slice(5)} – ${dates[dates.length - 1].slice(5)}` : '-'} sub={dates?.length ? dates[0].slice(0, 4) + '년' : ''} />
            <Stat label="이미 등록됨" value={existing ? `${parsed.orders.filter(o => existing.has(o.work_order_number)).length}건` : '확인 중'} sub="건너뜁니다" />
            <Stat label="새로 넣을 것" value={`${fresh.length.toLocaleString()}건`} sub={`잔여가 남은 것 ${withRemaining}건`} strong />
          </div>
          {parsed.skipped.length > 0 && (
            <details className="rounded-lg border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm">
              <summary className="cursor-pointer font-semibold">넣지 않는 줄 {parsed.skipped.length}개 — 내용이 비었거나 숫자가 아닙니다</summary>
              <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-muted-foreground">
                {parsed.skipped.slice(0, 200).map(s => <li key={s.row}>엑셀 {s.row}행 · {s.reason}</li>)}
              </ul>
            </details>
          )}

          {/* 3. 가져오기 방식 */}
          <Card>
            <CardContent className="space-y-4">
              <p className="font-bold">가져오기 방식</p>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-800" checked={producedFromShipped}
                  onChange={e => setProducedFromShipped(e.target.checked)} />
                <span><b>출고된 수량만큼은 생산 완료로 넣기</b><span className="block text-muted-foreground">다 출고된 의뢰서는 완료로 들어갑니다.</span></span>
              </label>
              <div className="space-y-2 text-sm">
                <p className="font-semibold">잔여가 남은 의뢰서 {withRemaining}건은</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Choice on={remainingStatus === 'archive'} onClick={() => setRemainingStatus('archive')}
                    title="완료로 보관 (권장)" desc="지난 기록으로만 남깁니다. 생산 현황 · 대시보드의 진행 중 목록에는 뜨지 않습니다." />
                  <Choice on={remainingStatus === 'active'} onClick={() => setRemainingStatus('active')}
                    title="진행 중으로 띄우기" desc="생산 현황에 남은 수량과 함께 뜹니다. 실제로 아직 만드는 의뢰서만 있을 때 고르세요." />
                </div>
                {remainingStatus === 'active' && producedFromShipped && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-warning-50 px-3 py-2 text-xs">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    진행 중 의뢰서의 품목에 생산 실적을 새로 넣으면, 그 품목의 완료 수량은 출고 기준으로 넣어 둔 값 대신 새로 넣은 실적의 합으로 바뀝니다.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-sm text-muted-foreground">
                  {plan
                    ? <>넣으면 <b className="text-foreground">완료 {plan.completed}건</b> · 진행 중 {plan.in_progress}건 · 대기 {plan.pending}건이 됩니다.</>
                    : '잔여 의뢰서를 어떻게 둘지 고르면 가져올 수 있습니다.'}
                </p>
                <Button onClick={runImport} disabled={!options || fresh.length === 0 || !!progress || !existing}>
                  {progress ? <Loader2 className="animate-spin" /> : <Upload />}
                  {progress ? `넣는 중… ${progress.done}/${progress.total}` : `새 작업의뢰서 ${fresh.length}건 가져오기`}
                </Button>
              </div>
              {progress && (
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
              )}
              {result && (
                <p className="flex items-center gap-1.5 rounded-lg bg-success-50 px-3 py-2 text-sm font-medium text-success">
                  <CheckCircle2 className="h-4 w-4" />작업의뢰서 {result.created}건 · 품목 {result.items}줄을 넣었습니다.
                  {result.skipped > 0 && ` 이미 있던 ${result.skipped}건은 건너뛰었습니다.`}
                  <Link href="/work-orders" className="ml-1 underline">작업의뢰서 목록 보기</Link>
                </p>
              )}
            </CardContent>
          </Card>

          {/* 4. 의뢰서 목록 */}
          <Card className="gap-0 py-0">
            <CardContent className="overflow-x-auto p-0">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">의뢰번호</TableHead>
                    <TableHead>거래처 · 현장</TableHead>
                    <TableHead>주문일 · 납품일</TableHead>
                    <TableHead className="text-right">품목</TableHead>
                    <TableHead className="text-right">수량</TableHead>
                    <TableHead className="text-right">출고</TableHead>
                    <TableHead className="text-right">잔여</TableHead>
                    <TableHead className="pr-5">넣을 상태</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(showAll ? parsed.orders : parsed.orders.slice(0, PREVIEW_ROWS)).map(o => (
                    <OrderRow key={o.work_order_number} o={o} exists={!!existing?.has(o.work_order_number)} options={options} />
                  ))}
                </TableBody>
              </Table>
              {!showAll && parsed.orders.length > PREVIEW_ROWS && (
                <button type="button" onClick={() => setShowAll(true)}
                  className="w-full border-t py-3 text-sm font-medium text-muted-foreground hover:bg-muted/50">
                  나머지 {parsed.orders.length - PREVIEW_ROWS}건 더 보기
                </button>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

const STATUS_LABEL = { pending: '대기', in_progress: '진행 중', completed: '완료' } as const;

function OrderRow({ o, exists, options }: { o: ErpListOrder; exists: boolean; options: ImportOptions | null }) {
  const status = options ? importPlan(o, options).status : null;
  return (
    <TableRow className={exists ? 'opacity-50' : ''}>
      <TableCell className="pl-5 font-bold text-brand-800">{o.work_order_number}</TableCell>
      <TableCell className="max-w-72">
        <p className="truncate text-sm font-medium">{o.customer || '-'}</p>
        <p className="truncate text-xs text-muted-foreground">{o.site || ''}</p>
      </TableCell>
      <TableCell className="tabular text-sm">{o.request_date ?? '-'}<span className="block text-xs text-muted-foreground">{o.delivery_date ?? ''}</span></TableCell>
      <TableCell className="tabular text-right">{o.items.length}</TableCell>
      <TableCell className="tabular text-right">{o.quantity.toLocaleString()}</TableCell>
      <TableCell className="tabular text-right">{o.shipped.toLocaleString()}</TableCell>
      <TableCell className={cn('tabular text-right', o.remaining > 0 && 'font-semibold text-warning')}>{o.remaining.toLocaleString()}</TableCell>
      <TableCell className="pr-5 text-sm">
        {exists ? <span className="text-muted-foreground">이미 등록됨</span> : status ? STATUS_LABEL[status] : <span className="text-muted-foreground">-</span>}
      </TableCell>
    </TableRow>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-5">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <p className={cn('tabular mt-1.5 text-2xl font-bold tracking-tight', strong && 'text-brand-800')}>{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Choice({ on, onClick, title, desc }: { on: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn('rounded-xl border p-3 text-left transition-colors', on ? 'border-brand-800 bg-brand-50 ring-1 ring-brand-800' : 'border-border hover:bg-muted/50')}>
      <span className="flex items-center gap-2 font-semibold">
        <span className={cn('flex h-4 w-4 items-center justify-center rounded-full border', on ? 'border-brand-800 bg-brand-800' : 'border-input')}>
          {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>{title}
      </span>
      <span className="mt-1 block break-keep text-xs text-muted-foreground">{desc}</span>
    </button>
  );
}
