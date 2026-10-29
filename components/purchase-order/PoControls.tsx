'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Ban, ChevronDown, ChevronUp, Download, Link2, Loader2, Search, Unlink, Upload, UserRound } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Progress from '@/components/ui/progress';
import { chipClass } from '@/components/ui/chip';
import { createClient } from '@/lib/supabase/client';
import { downloadChunked, formatBytes, saveBlob } from '@/lib/purchase-order/chunks';
import { checkSummary, type CheckResult } from '@/lib/purchase-order/match';

async function post(url: string, body: unknown, method = 'POST') {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || '처리하지 못했습니다.');
  return json;
}

/**
 * 파일 받기. 받기 전에 기록을 남긴다 — 담당자가 처음 받으면 그게 "확인" 이다.
 */
export function FileDownload({ poId, file }: {
  poId: string;
  file: { id: string; file_name: string; mime_type: string; size_bytes: number; storage_prefix: string; chunk_count: number; purged_at: string | null };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (file.purged_at) {
    return <span className="text-xs text-muted-foreground">정리됨 ({formatBytes(file.size_bytes)})</span>;
  }
  async function download() {
    setBusy(true);
    try {
      const { checked } = await post(`/api/purchase-orders/${poId}/events`, { action: 'downloaded', file_id: file.id });
      const blob = await downloadChunked(createClient(), file.storage_prefix, file.chunk_count, file.mime_type);
      saveBlob(blob, file.file_name);
      if (checked) { toast.success('확인으로 기록했습니다. 올린 사람에게 보입니다.'); router.refresh(); }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '받지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={download} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <Download />}받기 <span className="text-muted-foreground">{formatBytes(file.size_bytes)}</span>
    </Button>
  );
}

/** 담당자 바꾸기 · 내가 맡기 · 취소 */
export function PoActions({ poId, meId, assigneeId, canProcess, canCancel, assignees }: {
  poId: string;
  meId: string;
  assigneeId: string | null;
  canProcess: boolean;
  canCancel: boolean;
  assignees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(body: unknown, done: string) {
    setBusy(true);
    try {
      await post(`/api/purchase-orders/${poId}`, body, 'PATCH');
      toast.success(done);
      setPicking(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canProcess && assigneeId !== meId && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => run({ assignee_id: meId }, '내가 맡았습니다.')}>
            <UserRound />내가 맡기
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setPicking(!picking)}>
          담당자 바꾸기{picking ? <ChevronUp /> : <ChevronDown />}
        </Button>
        {canCancel && (
          <Button variant="outline" size="sm" disabled={busy} className="text-destructive"
            onClick={() => confirm('이 발주 건을 취소할까요? 담당자 목록에서 빠집니다.') && run({ cancel: true }, '취소했습니다.')}>
            <Ban />접수 취소
          </Button>
        )}
      </div>
      {picking && (
        <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/40 p-3">
          {assignees.map(a => (
            <button key={a.id} type="button" disabled={busy || a.id === assigneeId}
              className={chipClass(a.id === assigneeId)}
              onClick={() => run({ assignee_id: a.id }, `담당자를 ${a.name} 님으로 바꿨습니다.`)}>
              {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface PackageView {
  id: string;
  label: string;
  rows: { location: string; width_mm: number; height_mm: number; quantity: number }[];
  total_quantity: number;
  check_result: CheckResult | null;
  work_order: { id: string; work_order_number: string; total: number; produced: number } | null;
}

interface Candidate {
  work_order_id: string;
  work_order_number: string;
  customer_label: string | null;
  site_label: string | null;
  ok: boolean;
  summary: string;
}

/**
 * 포장 한 줄 — 작업의뢰서가 붙었으면 번호 · 생산 진행 · 대조 결과,
 * 안 붙었으면 "작업의뢰서 올리기" 와 "등록된 것에서 찾기".
 */
export function PackageRow({ poId, pkg, canLink }: { poId: string; pkg: PackageView; canLink: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function findCandidates() {
    setBusy(true);
    try {
      const res = await fetch(`/api/purchase-orders/suggest?package_id=${pkg.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setCandidates(json.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '찾지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function link(workOrderId: string | null) {
    setBusy(true);
    try {
      const json = await post('/api/purchase-orders/link', { package_id: pkg.id, work_order_id: workOrderId });
      if (workOrderId) {
        if (json.data.check.ok) toast.success(`연결했습니다 — ${json.data.summary}`);
        else toast.warning(`연결했지만 ERP 엑셀과 다릅니다 — ${json.data.summary}`);
      } else toast.success('연결을 끊었습니다.');
      setCandidates(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const wo = pkg.work_order;
  const check = pkg.check_result;
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
          <span className="truncate font-semibold">{pkg.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{pkg.rows.length}행 · {pkg.total_quantity}장</span>
        </button>

        {wo ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/work-orders/${wo.id}`} className="font-bold text-brand-800 hover:underline">{wo.work_order_number}</Link>
            {check && (
              <Badge variant={check.ok ? 'success' : 'destructive'} title={checkSummary(check)}>
                {check.ok ? '대조 일치' : `다름 ${check.diffs.length}`}
              </Badge>
            )}
            <Progress value={wo.total ? Math.round(wo.produced / wo.total * 100) : 0} className="w-32" />
            {canLink && (
              <button type="button" disabled={busy} title="연결 끊기"
                onClick={() => confirm(`${wo.work_order_number} 연결을 끊을까요?`) && link(null)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive">
                <Unlink className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : canLink ? (
          <div className="flex flex-wrap gap-2">
            <Link href={`/work-orders/receive?po=${poId}&pkg=${pkg.id}`} className={buttonVariants({ size: 'sm' })}>
              <Upload />작업의뢰서 올리기
            </Link>
            <Button variant="outline" size="sm" disabled={busy} onClick={findCandidates}>
              {busy ? <Loader2 className="animate-spin" /> : <Search />}등록된 것에서 찾기
            </Button>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">작업의뢰서 기다리는 중</span>
        )}
      </div>

      {candidates && (
        <div className="space-y-2 border-t bg-muted/30 px-4 py-3">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">규격이 닮은 작업의뢰서가 없습니다. ERP 에서 받은 파일을 올려 주세요.</p>
          ) : candidates.map(c => (
            <div key={c.work_order_id} className="flex flex-wrap items-center gap-3 text-sm">
              <b>{c.work_order_number}</b>
              <span className="text-muted-foreground">{[c.customer_label, c.site_label].filter(Boolean).join(' · ')}</span>
              <Badge variant={c.ok ? 'success' : 'warning'}>{c.summary}</Badge>
              <Button size="sm" variant={c.ok ? 'default' : 'outline'} disabled={busy} onClick={() => link(c.work_order_id)}>
                <Link2 />이 포장에 연결
              </Button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="border-t px-4 py-3">
          {check && !check.ok && (
            <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-semibold text-destructive">ERP 엑셀과 작업의뢰서가 다릅니다 — ERP 입력을 확인하세요</p>
              <table className="mt-2 text-xs">
                <thead><tr className="text-muted-foreground"><th className="pr-4 text-left">규격</th><th className="pr-4 text-right">ERP 엑셀</th><th className="text-right">작업의뢰서</th></tr></thead>
                <tbody>
                  {check.diffs.map(d => (
                    <tr key={`${d.width_mm}x${d.height_mm}`}>
                      <td className="pr-4 tabular">{d.width_mm} × {d.height_mm}</td>
                      <td className="pr-4 text-right tabular">{d.expected}</td>
                      <td className="text-right font-bold tabular">{d.actual}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground"><th className="text-left">위치</th><th className="text-right">가로</th><th className="text-right">세로</th><th className="text-right">수량</th></tr></thead>
            <tbody>
              {pkg.rows.map((r, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="py-1">{r.location}</td>
                  <td className="text-right tabular">{r.width_mm}</td>
                  <td className="text-right tabular">{r.height_mm}</td>
                  <td className="text-right tabular">{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
