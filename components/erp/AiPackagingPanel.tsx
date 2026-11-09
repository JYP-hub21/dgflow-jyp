'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCheck, Loader2, MessageSquareText, RotateCcw, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  MAX_INSTRUCTION, applySuggestion, estimateKrw, normalizeLabel, rowRangesText,
  type AiPackagingRequest, type AiPackagingSuggestion, type AiUsage, type AppliedSuggestion,
} from '@/lib/erp/ai-packaging';
import type { ManualPackage } from '@/lib/erp/packaging-rule';
import type { WorkOrderSourceItem } from '@/lib/work-order/build';

interface Result {
  suggestion: AiPackagingSuggestion;
  applied: AppliedSuggestion;
  usage: AiUsage;
  retried: boolean;
}

/**
 * AI 포장 — "포장 분리 방식" 칸 안.
 *
 * 2026-11-09 사용자 "제안 받기만 하지 말고, 얘한테 직접 이렇게 이렇게 포장할 거다 — 장황하게든 뭐든 요청할 수 있게".
 * 그래서 요청 칸을 크게 두고(말로 길게 적어도 된다), 결과를 본 뒤 "추가 요청" 으로 이어서 고친다 —
 * 서버는 앞선 요청들과 직전 제안을 같이 받아 그걸 바탕으로 고친다.
 * AI 답은 제안으로만 보여 주고, 사람이 "제안 적용" 을 눌러야 직접 짜기(포장 편집)로 넘어가 거기서 또 고칠 수 있다.
 */
export default function AiPackagingPanel({ buildRequest, rows, onApply }: {
  /** 지금 시트로 서버에 보낼 기본 내용을 만든다 */
  buildRequest: (instruction: string) => AiPackagingRequest | null;
  rows: WorkOrderSourceItem[];
  onApply: (packages: ManualPackage[]) => void;
}) {
  const [draft, setDraft] = useState('');
  /** 지금 결과를 만든 요청들 — 오래된 것부터 */
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  async function send() {
    const base = buildRequest(draft);
    if (!base || busy) return;
    const followUp = result !== null;
    const req: AiPackagingRequest = followUp ? { ...base, history, previous: result.suggestion } : base;
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
      const asked = draft.trim();
      setHistory(prev => (followUp ? prev : []).concat(asked ? [asked] : []));
      setDraft('');
    } catch (e) {
      // 이어서 고치다 실패하면 직전 결과는 그대로 둔다 — 적은 요청도 지우지 않는다
      setError(e instanceof Error ? e.message : 'AI 제안을 받지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setHistory([]);
    setDraft('');
    setError('');
  }

  const qtyOf = new Map(rows.filter(r => r.source_row !== undefined).map(r => [r.source_row!, r.quantity]));
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } };

  const requestBox = (follow: boolean) => (
    <div className="space-y-2">
      <label className="block text-[13px] font-semibold" htmlFor={follow ? 'ai-follow' : 'ai-request'}>
        {follow ? '추가 요청' : 'AI 에게 요청'}
        <span className="ml-1.5 font-normal text-muted-foreground">
          {follow ? '— 결과에서 고칠 점을 적으면 위 제안을 바탕으로 다시 짭니다' : '— 포장을 어떻게 할지 말로 적어 주세요. 길게 적어도 됩니다. 비우면 발주서대로 제안합니다'}
        </span>
      </label>
      <Textarea id={follow ? 'ai-follow' : 'ai-request'} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
        disabled={busy} rows={follow ? 2 : 4} maxLength={MAX_INSTRUCTION} className="bg-card text-sm leading-relaxed"
        placeholder={follow
          ? '예) 2동은 한 포장으로 합쳐 주세요. 발코니 유리는 동마다 따로 빼 주세요.'
          : '예) 이번 차수는 5동을 맨 앞에 싣습니다. 3동은 1~3호와 4,5호로 나누고, 4동은 전부 한 포장으로 합쳐 주세요. 발코니 유리는 동별로 따로 모아 주세요. 나머지는 발주서 지시대로 해 주세요.'} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="tabular text-xs text-muted-foreground">{draft.length.toLocaleString()} / {MAX_INSTRUCTION.toLocaleString()}자 · Ctrl+Enter 로 보내기</span>
        <div className="flex gap-2">
          {follow && <Button variant="ghost" size="sm" onClick={reset} disabled={busy}><RotateCcw />처음부터</Button>}
          <Button size={follow ? 'sm' : 'default'} onClick={send} disabled={busy || (follow && !draft.trim())}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            {busy ? 'AI 가 읽는 중…' : follow ? '추가 요청 보내기' : draft.trim() ? '요청 보내기' : '발주서대로 제안 받기'}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-brand-600" />AI 포장</p>
        <p className="mt-0.5 break-keep text-xs text-muted-foreground">
          AI 가 발주서의 포장 지시 · 동순서와 요청을 읽고 포장과 시트 순서를 짭니다. 결과를 보고 추가 요청으로 계속 고칠 수 있고,
          <b className="font-semibold text-foreground"> 제안 적용</b>을 눌러야 반영됩니다. 반영한 뒤에도 직접 짜기에서 고칠 수 있습니다.
        </p>
      </div>

      {!result && requestBox(false)}
      {busy && <p className="text-xs text-muted-foreground">발주서를 읽고 판단하는 데 보통 20초–1분 걸립니다.</p>}
      {error && <p className="break-keep rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      {result && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          {history.length > 0 && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><MessageSquareText className="h-3.5 w-3.5" />요청 기록</p>
              <ol className="space-y-1">
                {history.map((h, i) => (
                  <li key={i} className="flex gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-sm">
                    <span className="tabular shrink-0 font-semibold text-muted-foreground">{i + 1}</span>
                    <span className="whitespace-pre-wrap break-keep">{h}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

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

          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <p className="tabular text-xs text-muted-foreground">
              {result.retried && '빠진 행이 있어 AI 에게 한 번 더 물었습니다 · '}
              이번 요청 약 {estimateKrw(result.usage).toLocaleString()}원
              {' '}(입력 {(result.usage.input_tokens + (result.usage.cache_read ?? 0) + (result.usage.cache_write ?? 0)).toLocaleString()}
              {(result.usage.cache_read ?? 0) > 0 && ` 중 캐시 ${result.usage.cache_read!.toLocaleString()}`} · 출력 {result.usage.output_tokens.toLocaleString()} 토큰)
            </p>
            <Button size="sm" onClick={() => onApply(result.applied.packages)} disabled={busy || result.applied.packages.length === 0}>
              <CheckCheck />제안 적용 ({result.applied.packages.length}장)
            </Button>
          </div>

          {requestBox(true)}
        </div>
      )}
    </div>
  );
}
