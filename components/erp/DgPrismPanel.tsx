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

/**
 * 요청 칸에 한 번에 넣는 예시 문장 — **어느 발주서에나 맞는 말만** (2026-11-10 사용자 지적:
 * "1 · 2차" 는 한 발주서에만 있는 시트 이름이라 대표 예시로 두면 안 된다). 시트 이름 · 위치 · 품목은 사람이 뒤에 채운다.
 * merge 는 시트가 둘 이상일 때만 보인다.
 */
const QUICK: { label: string; text: string; merge?: boolean }[] = [
  { label: '발주서 지시대로', text: '발주서에 적힌 포장 지시와 싣는 순서대로 구성해 주세요.' },
  { label: '시트 합치기', text: '이 시트들을 합쳐서 한 번에 규격정리해 주세요:', merge: true },
  { label: '싣는 순서 변경', text: '싣는 순서를 다음과 같이 변경해 주세요:' },
  { label: '품목 제외', text: '이번 ERP 에서는 다음 품목을 제외해 주세요:' },
  { label: '이상 항목 점검', text: '이 발주서에서 확인이 필요한 이상 항목을 점검해 주세요.' },
];

/** 처음 화면에 보여 줄 "할 수 있는 일" — 빈 칸 대신 무엇을 시킬 수 있는지 알려 준다 */
const CAPABILITIES: { icon: React.ElementType; title: string; text: string }[] = [
  { icon: Boxes, title: '포장 구성', text: '발주서 지시 · 합계 행 · 동·호 기준으로 나누고, 요청에 따라 다시 나눕니다' },
  { icon: Layers, title: '시트 · 파일 합치기', text: '여러 시트와 여러 발주서 파일도 요청하면 불러와 한 번에 정리합니다' },
  { icon: ArrowDownUp, title: '싣는 순서', text: '동순서 · 포장 순서 · 포장 내 발주서 순서를 변경합니다' },
  { icon: Eraser, title: '품목 제외', text: '이번 ERP 에 넣지 않을 품목을 지정하면 제외합니다' },
  { icon: TextCursorInput, title: '위치 문구', text: '위치 칸의 불필요한 문구를 삭제하거나 변경합니다' },
  { icon: Tag, title: '사내 품명', text: '규격정리 오른쪽 품명에 ERP 품목명을 제안합니다' },
  { icon: CircleHelp, title: '질문', text: '수량이 몇 조인지, 이상 항목이 있는지 질문하세요' },
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
function sumUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read: (a.cache_read ?? 0) + (b.cache_read ?? 0),
    cache_write: (a.cache_write ?? 0) + (b.cache_write ?? 0),
    model: b.model,
  };
}

export default function DgPrismPanel({ ready, canMerge = false, sheetKey, sheetNames, buildRequest, rows, active, onResult, onLoadSheets, onEdit }: {
  /** 시트를 읽어 보낼 수 있는지 */
  ready: boolean;
  /** 올린 발주서에 시트가 둘 이상인지 — '시트 합치기' 예시는 그때만 보인다 */
  canMerge?: boolean;
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
  /** 그 시트들을 불러온다 — 이름이 맞지 않으면 false, 다른 표기로 이미 불러온 시트들이면 'already'(다시 읽지 않는다) */
  onLoadSheets: (names: string[]) => boolean | 'already';
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
  const resend = useRef<{ instruction: string; history: string[]; previous: AiPlan | null; usage: AiUsage; loaded: string[] } | null>(null);

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

  async function send(instruction = draft, carry?: { history: string[]; previous: AiPlan | null; usage?: AiUsage; loaded?: string[] }) {
    const base = buildRequest(instruction);
    if (!base || (busy && !carry)) return;
    const prevPlan = carry ? carry.previous : result?.plan.action === 'arrange' ? result.plan : null;
    const prevHistory = carry ? carry.history : result ? history : [];
    const req: AiPackagingRequest = { ...base, history: prevHistory, previous: prevPlan, just_loaded: carry?.loaded };
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
          throw new Error(`DG 프리즘이 시트(${wanted.join(', ') || '없음'})를 다시 불러오도록 요청했지만 이미 불러온 상태입니다. 요청 내용을 수정해 다시 전송하세요.`);
        }
        const pending = { instruction, history: prevHistory, previous: prevPlan, usage: body.usage as AiUsage, loaded: wanted };
        resend.current = pending;
        setNote(`${plan.reply || ''} ${wanted.join(' + ')} 시트를 불러와 이어서 구성하는 중입니다…`.trim());
        const loaded = onLoadSheets(wanted);
        if (!loaded) {
          resend.current = null;
          throw new Error(`"${wanted.join(', ')}" 시트를 찾지 못했습니다. 시트 이름을 확인하세요.`);
        }
        if (loaded === 'already') {
          // '1차' 처럼 다른 표기로 이미 불러온 시트('① 1차')를 달라고 했다 — 불러온 시트가 그대로라 sheetKey 가 안 바뀌어
          // 위 이어 보내기(effect)가 영영 안 돌고 '읽는 중' 에 멈췄다. 지금 시트 이름을 알려 주며 바로 한 번 더 보낸다 —
          // carry 가 있으니 또 시트를 달라고 하면 오류로 끝난다 (2026-11-10 점검)
          resend.current = null;
          await send(instruction, { ...pending, loaded: names });
          return;
        }
        return; // sheetKey 가 바뀌면 이어서 보낸다 — busy 는 그때 다시 켜진다
      }

      const applied = plan.action === 'arrange' ? applyPlan(plan, req.sheets) : null;
      // 시트를 불러오느라 한 번 더 물었으면 두 번 값을 더해 보여 준다
      const usage: AiUsage = carry?.usage ? sumUsage(carry.usage, body.usage) : body.usage;
      setResult({ plan, applied, usage, retried: !!body.retried, sheetNames: names });
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
  const box = useRef<HTMLTextAreaElement>(null);
  // 예시를 넣으면 바로 이어 쓰게 글 끝에 커서를 둔다 — "이 시트들을 합쳐서 …:" 뒤에 시트 이름을 적는다
  const addQuick = (q: string) => {
    const next = (draft.trim() ? `${draft.trim()} ${q}` : q).slice(0, MAX_INSTRUCTION);
    setDraft(q.endsWith(':') ? `${next} ` : next);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };
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
            <p className="break-keep text-[13px] text-muted-foreground">발주서 규격정리 전문가 — 질문하거나 지시하면 포장 · 순서 · 시트 합치기까지 처리합니다</p>
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
            <p className="break-keep text-xs text-muted-foreground">가로 · 세로 · 수량 숫자는 발주서에서 읽은 값을 그대로 유지하며, 변경하지 않습니다.</p>
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
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />발주서 해석 내용
                    </summary>
                    <p className="mt-1 break-keep leading-relaxed">{result.plan.understanding}</p>
                  </details>
                )}
              </div>
            </div>

            {result.applied && (
              <div className="rounded-lg bg-card ring-1 ring-border">
                <div className="border-b px-3.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="whitespace-nowrap text-sm font-semibold">
                      포장 {result.applied.packages.length}장 <span className="font-normal text-muted-foreground">· 싣는 순서대로</span>
                    </p>
                    {active
                      ? <span className="shrink-0 whitespace-nowrap rounded-full bg-success-50 px-2 py-0.5 text-xs font-semibold text-success">미리보기에 반영됨</span>
                      : (
                        <Button size="xs" variant="outline" onClick={() => onResult(result.applied!, result.plan)}>
                          <Undo2 />DG 프리즘 포장으로 다시 보기
                        </Button>
                      )}
                  </div>
                  {/* 합친 시트 — 파일 번호가 붙으면 길어져서 따로 한 줄 */}
                  {result.sheetNames.length > 1 && (
                    <p className="mt-1.5 flex items-start gap-1 rounded bg-brand-50 px-1.5 py-1 text-[11px] font-semibold leading-snug text-brand-700">
                      <Layers className="mt-px h-3 w-3 shrink-0" />{result.sheetNames.join(' + ')}
                    </p>
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
                            <span className="tabular text-xs text-muted-foreground">{p.rows.length}행 · {sumQty(p.rows).toLocaleString()}조</span>
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

            {/* 빠진 행 — 결과가 틀린 것이라 노란 '확인해 주세요' 에 묻히지 않게 따로 (2026-11-10 시험: 피트니스 40행이 빠진 채 반영됐다) */}
            {result.applied && result.applied.unassigned.length > 0 && (
              <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                <p className="flex items-start gap-1.5 font-semibold text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-keep">
                    품목 {result.applied.unassigned.length}행({sumQty(result.applied.unassigned).toLocaleString()}조)이 어느 포장에도 포함되지 않았습니다
                  </span>
                </p>
                <p className="break-keep text-xs text-muted-foreground">
                  {shorten(label(result.applied.unassigned))} — 이대로 다운로드하면 ERP 엑셀의 _미배정 시트에 별도로 포함됩니다. 재구성을 요청하면 대부분 바로잡힙니다.
                </p>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => void send(`${label(result.applied!.unassigned)} 행이 어느 포장에도 포함되지 않았습니다. 누락된 행까지 모두 포장에 넣어 다시 구성해 주세요.`)}>
                  <RotateCcw />누락 행 포함 재구성
                </Button>
              </div>
            )}

            {(() => {
              const a = result.applied;
              const notes = [
                ...result.plan.cautions,
                ...(a && a.duplicates.length > 0 ? [`두 포장에 겹친 행 ${a.duplicates.length}개(${shorten(label(a.duplicates))})는 앞 포장에 남겼습니다.`] : []),
                ...(a && a.emptyLabels.length > 0 ? [`품목이 없어 제외한 포장: ${a.emptyLabels.join(', ')}`] : []),
              ];
              return notes.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning-50 px-3 py-2 text-sm text-amber-900">
                  <li className="text-xs font-semibold">확인 필요 사항</li>
                  {notes.map((n, i) => (
                    <li key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /><span className="break-keep">{n}</span></li>
                  ))}
                </ul>
              );
            })()}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="tabular text-xs text-muted-foreground">
                {result.retried && '누락된 행이 있어 한 번 더 요청했습니다 · '}
                이번 요청 약 {estimateKrw(result.usage).toLocaleString()}원
              </p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy}><RotateCcw />처음부터</Button>
                {result.applied && (
                  <Button size="sm" variant="outline" onClick={onEdit} disabled={busy || !active}
                    title="포장과 함께 제외 품목 · 위치 수정 · 사내 품명 · 발주서 순서도 그대로 유지한 채 전환합니다">
                    <PencilRuler />직접 구성으로 수정
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 요청 칸 — 처음 요청이든 추가 요청이든 같은 자리 */}
        <div className="mt-auto space-y-2">
          <label htmlFor="dg-prism-request" className="block text-[13px] font-semibold">
            {result ? '이어서 요청' : 'DG 프리즘에게 요청'}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {result ? '— 수정할 내용이나 질문을 입력하면 위 결과를 바탕으로 이어서 처리합니다' : '— 질문과 지시 모두 가능합니다. 길게 입력해도 되며, 비워 두면 발주서대로 구성합니다'}
            </span>
          </label>
          <Textarea id="dg-prism-request" ref={box} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
            disabled={busy} rows={result ? 2 : 4} maxLength={MAX_INSTRUCTION}
            className="bg-card text-sm leading-relaxed shadow-xs"
            placeholder={result
              ? '예) 이 두 포장은 하나로 합쳐 주세요. / 이 포장은 모두 몇 조인지 알려 주세요. / 위치 칸에서 이 문구는 삭제해 주세요.'
              : '예) 포장은 발주서 지시대로 하고, 싣는 순서만 변경해 주세요. / 이 시트들을 합쳐서 정리해 주세요. / 전체 수량이 몇 조인지 알려 주세요.'} />
          {!result && (
            <div className="flex flex-wrap gap-1.5">
              {QUICK.filter(q => !q.merge || canMerge).map(q => (
                <button key={q.label} type="button" onClick={() => addQuick(q.text)} disabled={busy} title={q.text}
                  className="rounded-full border border-brand-600/25 bg-card px-2.5 py-1 text-xs text-brand-800 transition-colors hover:border-brand-600 hover:bg-brand-50">
                  + {q.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="tabular text-xs text-muted-foreground">
              {busy ? '' : ready ? `${draft.length.toLocaleString()} / ${MAX_INSTRUCTION.toLocaleString()}자 · Ctrl+Enter 로 전송` : '발주서를 업로드하면 요청할 수 있습니다'}
            </span>
            <Button onClick={() => void send()} disabled={!ready || busy || (!!result && !draft.trim())}
              className={cn(ready && !busy && 'shadow-md shadow-brand-600/20')}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              {busy ? 'DG 프리즘 분석 중…' : result ? '이어서 요청' : draft.trim() ? 'DG 프리즘에게 요청' : '발주서대로 구성 요청'}
            </Button>
          </div>
          {busy && (
            <p className="flex items-center gap-1.5 break-keep text-xs text-brand-800">
              <Sparkles className="h-3.5 w-3.5 shrink-0 animate-pulse" />{note || '발주서를 분석하는 중입니다. 보통 30초–2분 소요됩니다.'}
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
        <li><b>제외 품목</b> {applied.excluded.length}행 · {sumQty(applied.excluded).toLocaleString()}조 <span className="text-muted-foreground">({shorten(label(applied.excluded))})</span></li>
      )}
      {applied.locationEdits.map((e, i) => (
        <li key={i}><b>위치 수정</b> &lsquo;{e.find}&rsquo; → {e.replace ? <>&lsquo;{e.replace}&rsquo;</> : '삭제'} <span className="text-muted-foreground">({e.keys ? `${e.keys.length}행` : '전체'})</span></li>
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
