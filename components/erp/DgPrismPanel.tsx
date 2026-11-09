'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, MessageSquareText, PencilRuler, RotateCcw, Send, Sparkles, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  MAX_INSTRUCTION, applySuggestion, estimateKrw, normalizeLabel, rowRangesText,
  type AiPackagingRequest, type AiPackagingSuggestion, type AiUsage, type AppliedSuggestion,
} from '@/lib/erp/ai-packaging';
import type { ManualPackage } from '@/lib/erp/packaging-rule';
import type { WorkOrderSourceItem } from '@/lib/work-order/build';
import { cn } from '@/lib/utils';

interface Result {
  suggestion: AiPackagingSuggestion;
  applied: AppliedSuggestion;
  usage: AiUsage;
  retried: boolean;
}

/** 요청 칸에 한 번에 넣는 예시 문장 */
const QUICK: { label: string; text: string }[] = [
  { label: '발주서 지시대로', text: '발주서에 적힌 포장 지시와 동순서대로 짜 주세요.' },
  { label: '동마다 한 포장', text: '동마다 한 포장으로 묶어 주세요.' },
  { label: '싣는 순서 바꾸기', text: '○동을 맨 앞에 싣게 순서를 바꿔 주세요.' },
  { label: '발코니 따로', text: '발코니 유리는 동별로 따로 모아 주세요.' },
];

/**
 * DG 프리즘 — 동일유리 AI 포장 도우미 (2026-11-09).
 *
 * 사용자: "직접 짜기를 눌러야만 정렬되게 하지 말고, 처음부터 AI 가 강조되게 · 물어볼 수 있게, 이름은 동일유리와 연관 있게".
 * 프리즘 = 유리로 만든, 빛 한 줄기를 여러 색으로 나누는 것 — 발주서 한 장을 포장별로 나눠 주는 일과 같다.
 *
 * - 발주서를 놓기 전에도 요청을 적어 둘 수 있다. 시트를 읽으면 보낼 수 있다.
 * - 사람이 요청을 보내 받은 답은 곧바로 'DG 프리즘' 포장 방식으로 선택돼 아래 미리보기에 반영된다
 *   (다른 방식 칩을 누르면 언제든 되돌아가고, '직접 짜기로 고치기' 로 손으로 고친다).
 * - 결과를 보고 '추가 요청' 으로 이어서 고친다 — 서버가 앞선 요청 · 직전 제안을 같이 받아 고친다.
 */
export default function DgPrismPanel({ ready, sheetKey, buildRequest, rows, active, onResult, onEdit }: {
  /** 시트를 읽어 보낼 수 있는지 */
  ready: boolean;
  /** 시트가 바뀌면 대화를 새로 시작한다 (적어 둔 요청은 남긴다) */
  sheetKey: string;
  buildRequest: (instruction: string) => AiPackagingRequest | null;
  rows: WorkOrderSourceItem[];
  /** 지금 아래 미리보기가 DG 프리즘 포장인지 */
  active: boolean;
  /** 받은 포장을 미리보기에 반영한다 */
  onResult: (packages: ManualPackage[], summary: string) => void;
  /** 직접 짜기로 넘어가 손으로 고친다 */
  onEdit: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  // 다른 시트 · 다른 파일이면 앞선 대화는 맞지 않는다
  useEffect(() => { setResult(null); setHistory([]); setError(''); }, [sheetKey]);

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
      if (!res.ok) throw new Error(body.error ?? 'DG 프리즘이 답하지 못했습니다.');
      const suggestion = body.suggestion as AiPackagingSuggestion;
      const applied = applySuggestion(suggestion, req.item_rows);
      setResult({ suggestion, applied, usage: body.usage, retried: !!body.retried });
      const asked = draft.trim();
      setHistory(prev => (followUp ? prev : []).concat(asked ? [asked] : []));
      setDraft('');
      if (applied.packages.length > 0) onResult(applied.packages, summaryOf(suggestion));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'DG 프리즘이 답하지 못했습니다.');
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
  const addQuick = (q: string) => setDraft(d => (d.trim() ? `${d.trim()} ${q}` : q).slice(0, MAX_INSTRUCTION));

  return (
    <section aria-label="DG 프리즘"
      className="relative flex flex-col overflow-hidden rounded-xl border border-brand-600/25 bg-gradient-to-br from-brand-50 via-card to-card shadow-sm">
      {/* 프리즘을 지난 빛 — 위쪽 가는 무지개 띠 */}
      <div aria-hidden className="h-1 w-full bg-gradient-to-r from-brand-600 via-sky-400 to-emerald-400" />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <header className="flex items-start gap-3">
          <PrismMark />
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground">
              DG 프리즘
              <span className="rounded-full bg-brand-800 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">AI</span>
            </p>
            <p className="break-keep text-sm text-muted-foreground">
              동일유리 AI 포장 도우미 — 발주서를 읽고, 말로 적은 요청대로 포장과 싣는 순서를 짜 드려요.
            </p>
          </div>
        </header>

        {result && (
          <div className="space-y-3">
            {history.length > 0 && (
              <ol className="space-y-1">
                {history.map((h, i) => (
                  <li key={i} className="flex gap-2 rounded-lg bg-card/80 px-3 py-1.5 text-sm ring-1 ring-border">
                    <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="whitespace-pre-wrap break-keep">{h}</span>
                  </li>
                ))}
              </ol>
            )}

            <div className="rounded-lg bg-card px-3.5 py-3 ring-1 ring-brand-600/20">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-brand-800"><Sparkles className="h-3.5 w-3.5" />이렇게 이해했어요</p>
              <p className="break-keep text-sm leading-relaxed">{result.suggestion.understanding}</p>
            </div>

            <div className="rounded-lg bg-card ring-1 ring-border">
              <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2">
                <p className="text-sm font-semibold">포장 {result.applied.packages.length}장 <span className="font-normal text-muted-foreground">· 싣는 순서대로</span></p>
                {active
                  ? <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-semibold text-success">아래 미리보기에 반영됨</span>
                  : (
                    <Button size="xs" variant="outline" onClick={() => onResult(result.applied.packages, summaryOf(result.suggestion))}>
                      <Undo2 />DG 프리즘 포장으로 다시 보기
                    </Button>
                  )}
              </div>
              <ol className="max-h-64 divide-y overflow-y-auto">
                {result.applied.packages.map((p, i) => (
                  <li key={p.id} className="flex gap-3 px-3.5 py-2 text-sm">
                    <span className="tabular w-5 shrink-0 text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <b>{p.label}</b>
                        <span className="tabular text-xs text-muted-foreground">
                          {p.rows.length}행 · {p.rows.reduce((s, r) => s + (qtyOf.get(r) ?? 0), 0).toLocaleString()}장
                        </span>
                      </p>
                      <p className="break-keep text-xs text-muted-foreground">
                        {result.suggestion.packages.find(s => normalizeLabel(s.label) === p.label)?.reason ?? ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {(() => {
              const notes = [
                ...result.suggestion.cautions,
                ...(result.applied.unassigned.length > 0
                  ? [`어느 포장에도 안 들어간 품목 ${result.applied.unassigned.length}행 (${shortRanges(result.applied.unassigned)}) — 엑셀의 _미배정 시트로 따로 내려갑니다. 추가 요청으로 다시 짜 달라고 해 보세요.`] : []),
                ...(result.applied.duplicates.length > 0
                  ? [`두 포장에 겹친 행 ${result.applied.duplicates.length}개(${shortRanges(result.applied.duplicates)})는 앞 포장에 남겼습니다.`] : []),
                ...(result.applied.emptyLabels.length > 0 ? [`품목이 없어 뺀 포장: ${result.applied.emptyLabels.join(', ')}`] : []),
              ];
              return notes.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning-50 px-3 py-2 text-sm text-amber-900">
                  <li className="text-xs font-semibold">확인해 주세요</li>
                  {notes.map((n, i) => (
                    <li key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /><span className="break-keep">{n}</span></li>
                  ))}
                </ul>
              );
            })()}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="tabular text-xs text-muted-foreground">
                {result.retried && '빠진 행이 있어 한 번 더 물었습니다 · '}
                이번 요청 약 {estimateKrw(result.usage).toLocaleString()}원
              </p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy}><RotateCcw />처음부터</Button>
                <Button size="sm" variant="outline" onClick={onEdit} disabled={busy || !active}><PencilRuler />직접 짜기로 고치기</Button>
              </div>
            </div>
          </div>
        )}

        {/* 요청 칸 — 처음 요청이든 추가 요청이든 같은 자리 */}
        <div className="mt-auto space-y-2">
          <label htmlFor="dg-prism-request" className="block text-[13px] font-semibold">
            {result ? '추가 요청' : 'DG 프리즘에게 요청'}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {result ? '— 고칠 점을 적으면 위 포장을 바탕으로 다시 짜요' : '— 길게 적어도 돼요. 비우면 발주서대로 짜요'}
            </span>
          </label>
          <Textarea id="dg-prism-request" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
            disabled={busy} rows={result ? 2 : 4} maxLength={MAX_INSTRUCTION}
            className="bg-card text-sm leading-relaxed shadow-xs"
            placeholder={result
              ? '예) 2동은 한 포장으로 합쳐 주세요. 발코니 유리는 동마다 따로 빼 주세요.'
              : '예) 이번 차수는 5동을 맨 앞에 싣습니다. 3동은 1~3호와 4,5호로 나누고, 4동은 전부 한 포장으로 합쳐 주세요. 나머지는 발주서 지시대로 해 주세요.'} />
          {!result && (
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map(q => (
                <button key={q.label} type="button" onClick={() => addQuick(q.text)} disabled={busy} title={q.text}
                  className="rounded-full border border-brand-600/25 bg-card px-2.5 py-1 text-xs text-brand-800 transition-colors hover:border-brand-600 hover:bg-brand-50">
                  + {q.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="tabular text-xs text-muted-foreground">
              {busy ? '' : ready ? `${draft.length.toLocaleString()} / ${MAX_INSTRUCTION.toLocaleString()}자 · Ctrl+Enter 로 보내기` : '발주서를 놓고 시트를 고르면 보낼 수 있어요'}
            </span>
            <Button onClick={send} disabled={!ready || busy || (!!result && !draft.trim())}
              className={cn(ready && !busy && 'shadow-md shadow-brand-600/20')}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              {busy ? 'DG 프리즘이 읽는 중…' : result ? '추가 요청 보내기' : draft.trim() ? 'DG 프리즘에게 요청' : '발주서대로 짜 달라고 하기'}
            </Button>
          </div>
          {busy && (
            <p className="flex items-center gap-1.5 text-xs text-brand-800">
              <Sparkles className="h-3.5 w-3.5 animate-pulse" />발주서를 읽고 포장을 나누는 중이에요. 보통 20초–1분 걸려요.
            </p>
          )}
          {error && <p className="break-keep rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        </div>
      </div>
    </section>
  );
}

/** 행 범위가 길면 앞의 몇 곳만 — 경고 칸이 화면을 다 덮지 않게 */
function shortRanges(rows: number[], max = 6): string {
  const parts = rowRangesText(rows).split(', ');
  return parts.length > max ? `${parts.slice(0, max).join(', ')} 외 ${parts.length - max}곳` : parts.join(', ');
}

/** 포장 분리 근거 줄에 쓸 한 줄 요약 — 이해한 내용의 첫 문장 */
function summaryOf(s: AiPackagingSuggestion): string {
  const first = s.understanding.split(/(?<=[.다요])\s/)[0] ?? '';
  return first.length > 140 ? `${first.slice(0, 140)}…` : first;
}

/** 프리즘 표시 — 빛 한 줄기가 들어가 여러 색으로 나뉘어 나온다 */
function PrismMark() {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-900 shadow-sm">
      <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden>
        <path d="M2 21 L15 19" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M20 7 L30 29 L10 29 Z" fill="rgba(255,255,255,0.12)" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M24 20 L38 15" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M25 22 L38 21" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M26 24 L38 27" stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}
