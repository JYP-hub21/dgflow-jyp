'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  applySuggestion, estimateKrw, normalizeLabel, rowRangesText,
  type AiPackagingRequest, type AiPackagingSuggestion, type AiUsage, type AppliedSuggestion,
} from '@/lib/erp/ai-packaging';
import type { ManualPackage } from '@/lib/erp/packaging-rule';
import type { WorkOrderSourceItem } from '@/lib/work-order/build';

/**
 * AI 포장 제안 — "포장 분리 방식" 칸 안.
 * AI 답은 제안으로만 보여 주고, 사람이 "이 제안으로 직접 짜기" 를 눌러야 포장 편집으로 넘어간다.
 */
export default function AiPackagingPanel({ buildRequest, rows, onApply }: {
  /** 지금 시트로 서버에 보낼 내용을 만든다 */
  buildRequest: (instruction: string) => AiPackagingRequest | null;
  rows: WorkOrderSourceItem[];
  onApply: (packages: ManualPackage[]) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ suggestion: AiPackagingSuggestion; applied: AppliedSuggestion; usage: AiUsage; retried: boolean } | null>(null);

  async function ask() {
    const req = buildRequest(instruction);
    if (!req) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/erp/ai-packaging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'AI 제안을 받지 못했습니다.');
      const suggestion = body.suggestion as AiPackagingSuggestion;
      setResult({ suggestion, applied: applySuggestion(suggestion, req.item_rows), usage: body.usage, retried: !!body.retried });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'AI 제안을 받지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const qtyOf = new Map(rows.filter(r => r.source_row !== undefined).map(r => [r.source_row!, r.quantity]));

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-brand-600" />AI 포장 제안</p>
          <p className="mt-0.5 break-keep text-xs text-muted-foreground">
            발주서의 포장 지시 · 동순서와 아래에 적은 지시를 AI 가 읽고 포장과 시트 순서를 제안합니다.
            제안은 바로 적용되지 않으며, 확인한 뒤 직접 짜기로 가져와 고칠 수 있습니다.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea aria-label="AI 에게 줄 지시" value={instruction} onChange={e => setInstruction(e.target.value)} disabled={busy}
          rows={2} maxLength={1000} className="min-h-0 flex-1 bg-card text-sm"
          placeholder="추가 지시 (선택) — 예: 동순서 3-4-2-1-5 로 싣고, 1~3호와 4,5호는 따로 포장" />
        <Button onClick={ask} disabled={busy} className="shrink-0">
          {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
          {busy ? 'AI 가 읽는 중…' : result ? '다시 제안 받기' : 'AI 제안 받기'}
        </Button>
      </div>
      {busy && <p className="text-xs text-muted-foreground">발주서를 읽고 판단하는 데 보통 30초–1분 걸립니다.</p>}
      {error && <p className="break-keep rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      {result && !busy && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <p className="break-keep text-sm leading-relaxed">{result.suggestion.understanding}</p>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-3">순서</TableHead>
                  <TableHead>포장 (시트)</TableHead>
                  <TableHead>발주서 행</TableHead>
                  <TableHead className="text-right">품목</TableHead>
                  <TableHead className="text-right">수량</TableHead>
                  <TableHead className="pr-3">근거</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.applied.packages.map((p, i) => (
                  <TableRow key={p.id}>
                    <TableCell className="tabular pl-3 text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-semibold">{p.label}</TableCell>
                    <TableCell className="tabular min-w-[160px] max-w-[260px] whitespace-normal text-xs text-muted-foreground">{rowRangesText(p.rows)}</TableCell>
                    <TableCell className="tabular text-right">{p.rows.length}행</TableCell>
                    <TableCell className="tabular text-right font-semibold">{p.rows.reduce((s, r) => s + (qtyOf.get(r) ?? 0), 0)}</TableCell>
                    <TableCell className="min-w-[200px] max-w-[320px] whitespace-normal break-keep pr-3 text-xs text-muted-foreground">
                      {result.suggestion.packages.find(s => normalizeLabel(s.label) === p.label)?.reason ?? ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {(() => {
            const notes = [
              ...result.suggestion.cautions,
              ...(result.applied.unassigned.length > 0
                ? [`어느 포장에도 안 들어간 품목 ${result.applied.unassigned.length}행: ${rowRangesText(result.applied.unassigned)} — 직접 짜기에서 붉게 표시됩니다.`] : []),
              ...(result.applied.duplicates.length > 0
                ? [`두 포장에 겹쳐 제안된 행 ${result.applied.duplicates.length}개(${rowRangesText(result.applied.duplicates)})는 앞 포장에 남겼습니다.`] : []),
              ...(result.applied.emptyLabels.length > 0
                ? [`품목이 없어 뺀 포장: ${result.applied.emptyLabels.join(', ')}`] : []),
            ];
            return notes.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning-50 px-3 py-2 text-sm text-amber-900">
                {notes.map((n, i) => (
                  <li key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /><span className="break-keep">{n}</span></li>
                ))}
              </ul>
            );
          })()}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="tabular text-xs text-muted-foreground">
              {result.retried && '빠진 행이 있어 AI 에게 한 번 더 물었습니다 · '}
              이번 요청 {result.usage.input_tokens.toLocaleString()} + {result.usage.output_tokens.toLocaleString()} 토큰 · 약 {estimateKrw(result.usage).toLocaleString()}원
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setResult(null)}><RotateCcw />닫기</Button>
              <Button size="sm" onClick={() => onApply(result.applied.packages)} disabled={result.applied.packages.length === 0}>
                이 제안으로 직접 짜기 ({result.applied.packages.length}장)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
