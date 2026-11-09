'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownUp, Boxes, ChevronDown, CircleHelp, Eraser, Layers, Loader2, PencilRuler, RotateCcw, Send, Sparkles, Tag, TextCursorInput, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  MAX_INSTRUCTION, applyPlan, estimateKrw, keysLabel, normalizeLabel,
  type AiPackagingRequest, type AiPlan, type AiUsage, type AppliedPlan,
} from '@/lib/erp/ai-packaging';
import type { WorkOrderSourceItem } from '@/lib/work-order/build';
import { cn } from '@/lib/utils';

interface Result {
  plan: AiPlan;
  /** arrange 일 때만 */
  applied: AppliedPlan | null;
  usage: AiUsage;
  retried: boolean;
  sheetNames: string[];
}

/** 요청 칸에 한 번에 넣는 예시 문장 */
const QUICK: { label: string; text: string }[] = [
  { label: '발주서 지시대로', text: '발주서에 적힌 포장 지시와 동순서대로 짜 주세요.' },
  { label: '1·2차 합쳐서', text: '1차와 2차를 합쳐서 규격정리해 주세요.' },
  { label: '싣는 순서 바꾸기', text: '○동을 맨 앞에 싣게 순서를 바꿔 주세요.' },
  { label: '발코니 따로', text: '발코니 유리는 동별로 따로 모아 주세요.' },
  { label: '이상한 곳 찾기', text: '이 발주서에서 확인해야 할 이상한 곳을 찾아 주세요.' },
];

/** 처음 화면에 보여 줄 "할 수 있는 일" — 빈 칸 대신 무엇을 시킬 수 있는지 알려 준다 */
const CAPABILITIES: { icon: React.ElementType; title: string; text: string }[] = [
  { icon: Boxes, title: '포장 짜기', text: '발주서 지시 · 합계 행 · 동·호로 나누고, 원하는 대로 다시 나눠요' },
  { icon: Layers, title: '차수 합치기', text: '1차 · 2차처럼 여러 시트를 불러와 한 번에 정리해요' },
  { icon: ArrowDownUp, title: '싣는 순서', text: '동순서 · 포장 순서 · 포장 안 발주서 순서를 바꿔요' },
  { icon: Eraser, title: '품목 빼기', text: '발코니 · 파손분처럼 이번에 뺄 품목을 빼요' },
  { icon: TextCursorInput, title: '위치 글자', text: '"구조마감" 같은 말을 지우거나 바꿔요' },
  { icon: Tag, title: '사내 품명', text: '규격정리 오른쪽 품명을 ERP 품목명으로 제안해요' },
  { icon: CircleHelp, title: '질문', text: '몇 장인지, 이상한 곳이 있는지 물어보세요' },
];

/**
 * DG 프리즘 — 동일유리 발주서 규격정리 전문가 AI (2026-11-09, 2.0).
 *
 * 사용자: "발주서 규격정리에 한해서는 내가 만든 AI 가 전문가여야 해 — 어떤 요구사항이나 명령이든 다 들어줄 수 있어야지".
 * - 질문에는 답만 하고(answer), 다른 차수 시트가 필요하면 스스로 불러오게 한 뒤 같은 요청을 다시 보내고(load_sheets),
 *   포장 · 순서 · 뺄 품목 · 위치 글자 · 사내 품명은 계획(arrange)으로 받아 'DG 프리즘' 포장 방식으로 바로 미리보기에 반영한다.
 * - 다른 방식 칩을 누르면 언제든 되돌아가고, '직접 짜기로 고치기' 로 손으로 고친다.
 * - 결과를 보고 '추가 요청' 으로 이어서 고친다 — 서버가 앞선 요청 · 직전 계획을 같이 받아 고친다.
 */
export default function DgPrismPanel({ ready, sheetKey, sheetNames, buildRequest, rows, active, onResult, onLoadSheets, onEdit }: {
  /** 시트를 읽어 보낼 수 있는지 */
  ready: boolean;
  /** 불러온 시트가 바뀌면 대화를 새로 시작한다 (적어 둔 요청은 남긴다) */
  sheetKey: string;
  /** 지금 불러온 시트 이름 — 행 이름을 "2차 15" 처럼 보여 줄 때 */
  sheetNames: string[];
  buildRequest: (instruction: string) => AiPackagingRequest | null;
  rows: WorkOrderSourceItem[];
  /** 지금 아래 미리보기가 DG 프리즘 포장인지 */
  active: boolean;
  /** 받은 계획을 미리보기에 반영한다 */
  onResult: (applied: AppliedPlan, plan: AiPlan) => void;
  /** 그 시트들을 불러온다 — 이름이 맞지 않으면 false */
  onLoadSheets: (names: string[]) => boolean;
  /** 직접 짜기로 넘어가 손으로 고친다 */
  onEdit: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  /** 시트를 불러온 뒤 다시 보낼 요청 — 불러오기가 끝나 sheetKey 가 바뀌면 보낸다 */
  const resend = useRef<{ instruction: string; history: string[]; previous: AiPlan | null } | null>(null);

  // 다른 시트 · 다른 파일이면 앞선 대화는 맞지 않는다 — 단, DG 프리즘이 스스로 시트를 불러온 경우는 이어서 보낸다
  useEffect(() => {
    const pending = resend.current;
    if (pending) {
      resend.current = null;
      void send(pending.instruction, pending);
      return;
    }
    setResult(null); setHistory([]); setError(''); setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetKey]);

  async function send(instruction = draft, carry?: { history: string[]; previous: AiPlan | null }) {
    const base = buildRequest(instruction);
    if (!base || (busy && !carry)) return;
    const prevPlan = carry ? carry.previous : result?.plan.action === 'arrange' ? result.plan : null;
    const prevHistory = carry ? carry.history : result ? history : [];
    const req: AiPackagingRequest = { ...base, history: prevHistory, previous: prevPlan };
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
      const plan = body.plan as AiPlan;
      const names = req.sheets.map(s => s.name);

      if (plan.action === 'load_sheets') {
        const wanted = plan.sheets.map(s => s.trim()).filter(Boolean);
        const same = wanted.length === names.length && wanted.every(w => names.includes(w));
        if (carry || same || wanted.length === 0) {
          throw new Error(`DG 프리즘이 시트(${wanted.join(', ') || '없음'})를 다시 불러 달라고 했지만 이미 불러온 상태입니다. 요청을 조금 바꿔 다시 보내 주세요.`);
        }
        resend.current = { instruction, history: prevHistory, previous: prevPlan };
        setNote(`${plan.reply || ''} ${wanted.join(' + ')} 시트를 불러와 이어서 짜고 있어요…`.trim());
        if (!onLoadSheets(wanted)) {
          resend.current = null;
          throw new Error(`"${wanted.join(', ')}" 시트를 찾지 못했어요. 시트 이름을 확인해 주세요.`);
        }
        return; // sheetKey 가 바뀌면 이어서 보낸다 — busy 는 그때 다시 켜진다
      }

      const applied = plan.action === 'arrange' ? applyPlan(plan, req.sheets) : null;
      setResult({ plan, applied, usage: body.usage, retried: !!body.retried, sheetNames: names });
      const asked = instruction.trim();
      setHistory(prevHistory.concat(asked ? [asked] : []));
      setDraft('');
      setNote('');
      if (applied && applied.packages.length > 0) onResult(applied, plan);
    } catch (e) {
      setNote('');
      setError(e instanceof Error ? e.message : 'DG 프리즘이 답하지 못했습니다.');
    } finally {
      if (!resend.current) setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setHistory([]);
    setDraft('');
    setError('');
    setNote('');
  }

  const qtyOf = new Map(rows.filter(r => r.source_row !== undefined).map(r => [r.source_row!, r.quantity]));
  const sumQty = (keys: number[]) => keys.reduce((s, k) => s + (qtyOf.get(k) ?? 0), 0);
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } };
  const addQuick = (q: string) => setDraft(d => (d.trim() ? `${d.trim()} ${q}` : q).slice(0, MAX_INSTRUCTION));
  const label = (keys: number[]) => keysLabel(keys, result?.sheetNames ?? sheetNames);

  return (
    <section aria-label="DG 프리즘"
      className="relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-1 flex-col gap-4 p-5">
        {/* 머리 — 2026-11-09 "생긴 게 아쉽다 · 문양이 저게 뭐니": 무지개 띠 · 진한 배경 · 빛줄기를 걷어 내고 단정하게 */}
        <header className="flex items-center gap-3">
          <PrismMark />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[17px] font-bold tracking-tight text-foreground">
              DG 프리즘
              <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/20">AI</span>
            </p>
            <p className="break-keep text-[13px] text-muted-foreground">발주서 규격정리 전문가 — 묻거나 시키면 포장 · 순서 · 차수 합치기까지 해 드려요</p>
          </div>
        </header>

        {!result && (
          <div className="space-y-2">
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {CAPABILITIES.map(c => (
                <li key={c.title} className="flex gap-2.5 rounded-lg bg-muted/40 px-3 py-2">
                  <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-tight">{c.title}</p>
                    <p className="break-keep text-xs leading-snug text-muted-foreground">{c.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="break-keep text-xs text-muted-foreground">가로 · 세로 · 수량 숫자는 발주서에서 읽은 그대로 두고, 바꾸지 않아요.</p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            {history.length > 0 && (
              <ol className="space-y-1">
                {history.map((h, i) => (
                  <li key={i} className="ml-auto flex max-w-[92%] gap-2 rounded-xl rounded-tr-sm bg-brand-800 px-3 py-1.5 text-sm text-white">
                    <span className="whitespace-pre-wrap break-keep">{h}</span>
                  </li>
                ))}
              </ol>
            )}

            {/* DG 프리즘의 답 */}
            <div className="flex gap-2.5">
              <PrismMark small />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="whitespace-pre-wrap break-keep rounded-xl rounded-tl-sm bg-muted/60 px-3.5 py-2.5 text-sm leading-relaxed">{result.plan.reply}</p>
                {result.plan.understanding && (
                  <details className="group text-xs text-muted-foreground">
                    <summary className="flex cursor-pointer list-none items-center gap-1 font-medium hover:text-foreground">
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />발주서를 이렇게 읽었어요
                    </summary>
                    <p className="mt-1 break-keep leading-relaxed">{result.plan.understanding}</p>
                  </details>
                )}
              </div>
            </div>

            {result.applied && (
              <div className="rounded-lg bg-card ring-1 ring-border">
                <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    포장 {result.applied.packages.length}장
                    {result.sheetNames.length > 1 && <span className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700"><Layers className="h-3 w-3" />{result.sheetNames.join(' + ')}</span>}
                    <span className="font-normal text-muted-foreground">· 싣는 순서대로</span>
                  </p>
                  {active
                    ? <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-semibold text-success">미리보기에 반영됨</span>
                    : (
                      <Button size="xs" variant="outline" onClick={() => onResult(result.applied!, result.plan)}>
                        <Undo2 />DG 프리즘 포장으로 다시 보기
                      </Button>
                    )}
                </div>
                <ol className="max-h-64 divide-y overflow-y-auto">
                  {result.applied.packages.map((p, i) => {
                    const src = result.plan.packages.find(s => normalizeLabel(s.label) === p.label);
                    return (
                      <li key={p.id} className="flex gap-3 px-3.5 py-2 text-sm">
                        <span className="tabular w-5 shrink-0 text-muted-foreground">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline gap-x-2">
                            <b>{p.label}</b>
                            <span className="tabular text-xs text-muted-foreground">{p.rows.length}행 · {sumQty(p.rows).toLocaleString()}장</span>
                            {src?.row_order === 'source' && <span className="rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">발주서 순서 유지</span>}
                          </p>
                          {src?.reason && <p className="break-keep text-xs text-muted-foreground">{src.reason}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <ApplyDetails applied={result.applied} label={label} sumQty={sumQty} />
              </div>
            )}

            {(() => {
              const a = result.applied;
              const notes = [
                ...result.plan.cautions,
                ...(a && a.unassigned.length > 0 ? [`어느 포장에도 안 들어간 품목 ${a.unassigned.length}행 (${shorten(label(a.unassigned))}) — 엑셀의 _미배정 시트로 따로 내려갑니다. 추가 요청으로 다시 짜 달라고 해 보세요.`] : []),
                ...(a && a.duplicates.length > 0 ? [`두 포장에 겹친 행 ${a.duplicates.length}개(${shorten(label(a.duplicates))})는 앞 포장에 남겼습니다.`] : []),
                ...(a && a.emptyLabels.length > 0 ? [`품목이 없어 뺀 포장: ${a.emptyLabels.join(', ')}`] : []),
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
                {result.applied && <Button size="sm" variant="outline" onClick={onEdit} disabled={busy || !active}><PencilRuler />직접 짜기로 고치기</Button>}
              </div>
            </div>
          </div>
        )}

        {/* 요청 칸 — 처음 요청이든 추가 요청이든 같은 자리 */}
        <div className="mt-auto space-y-2">
          <label htmlFor="dg-prism-request" className="block text-[13px] font-semibold">
            {result ? '이어서 요청' : 'DG 프리즘에게 요청'}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {result ? '— 고칠 점이나 궁금한 것을 적으면 위 결과를 바탕으로 이어서 해요' : '— 질문도 되고 지시도 돼요. 길게 적어도 되고, 비우면 발주서대로 짜요'}
            </span>
          </label>
          <Textarea id="dg-prism-request" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
            disabled={busy} rows={result ? 2 : 4} maxLength={MAX_INSTRUCTION}
            className="bg-card text-sm leading-relaxed shadow-xs"
            placeholder={result
              ? '예) 2동은 한 포장으로 합쳐 주세요. / 3동은 몇 장이에요? / 위치에서 "구조마감" 은 빼 주세요.'
              : '예) 1차와 2차를 합쳐서 규격정리해 주세요. 5동을 맨 앞에 싣고, 발코니 유리는 동별로 따로 모아 주세요. 나머지는 발주서 지시대로 해 주세요.'} />
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
            <Button onClick={() => void send()} disabled={!ready || busy || (!!result && !draft.trim())}
              className={cn(ready && !busy && 'shadow-md shadow-brand-600/20')}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              {busy ? 'DG 프리즘이 읽는 중…' : result ? '이어서 요청' : draft.trim() ? 'DG 프리즘에게 요청' : '발주서대로 짜 달라고 하기'}
            </Button>
          </div>
          {busy && (
            <p className="flex items-center gap-1.5 break-keep text-xs text-brand-800">
              <Sparkles className="h-3.5 w-3.5 shrink-0 animate-pulse" />{note || '발주서를 꼼꼼히 읽고 판단하는 중이에요. 보통 30초–2분 걸려요.'}
            </p>
          )}
          {error && <p className="break-keep rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        </div>
      </div>
    </section>
  );
}

/** 포장 말고 DG 프리즘이 함께 정한 것 — 뺀 품목 · 위치 고치기 · 사내 품명 */
function ApplyDetails({ applied, label, sumQty }: {
  applied: AppliedPlan;
  label: (keys: number[]) => string;
  sumQty: (keys: number[]) => number;
}) {
  const names = Object.entries(applied.productNames);
  if (applied.excluded.length === 0 && applied.locationEdits.length === 0 && names.length === 0) return null;
  return (
    <ul className="space-y-1 border-t bg-muted/30 px-3.5 py-2 text-xs">
      {applied.excluded.length > 0 && (
        <li><b>뺀 품목</b> {applied.excluded.length}행 · {sumQty(applied.excluded).toLocaleString()}장 <span className="text-muted-foreground">({shorten(label(applied.excluded))})</span></li>
      )}
      {applied.locationEdits.map((e, i) => (
        <li key={i}><b>위치 고치기</b> &lsquo;{e.find}&rsquo; → {e.replace ? <>&lsquo;{e.replace}&rsquo;</> : '지움'} <span className="text-muted-foreground">({e.keys ? `${e.keys.length}행` : '전체'})</span></li>
      ))}
      {names.length > 0 && (
        <li><b>규격정리 사내 품명</b> {names.map(([f, t]) => `${f} → ${t}`).join(' · ')}</li>
      )}
    </ul>
  );
}

/** 행 범위가 길면 앞부분만 — 경고 칸이 화면을 다 덮지 않게 */
function shorten(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}… 외` : text;
}

/** 프리즘 표시 — 단정한 삼각 프리즘 하나. 색은 파랑에서 청록으로 번지는 빛 */
function PrismMark({ small }: { small?: boolean }) {
  const id = useId();
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-xl bg-brand-50 ring-1 ring-inset ring-brand-600/15', small ? 'h-7 w-7 rounded-lg' : 'h-10 w-10')}>
      <svg viewBox="0 0 24 24" className={small ? 'h-4 w-4' : 'h-[22px] w-[22px]'} aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3182F6" />
            <stop offset="1" stopColor="#14B8A6" />
          </linearGradient>
        </defs>
        <path d="M12 3 L21 19.5 H3 Z" fill={`url(#${id})`} stroke={`url(#${id})`} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M12 10 L15.4 16.3 H8.6 Z" fill="#fff" fillOpacity="0.85" />
      </svg>
    </span>
  );
}
