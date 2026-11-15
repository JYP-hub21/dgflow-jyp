'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUp, ChevronRight, Loader2, RotateCcw, X } from 'lucide-react';
import PrismMark from '@/components/prism/PrismMark';
import { useCurrentUser } from '@/components/layout/CurrentUser';
import { answerAsText, LINKS, MAX_QUESTION, type ChatTurn, type PrismAnswer, type Tone } from '@/lib/prism/chat';
import { cn } from '@/lib/utils';

/**
 * DG 프리즘 대화창 (2026-11-15) — 어느 화면에서나 왼쪽 메뉴의 "DG 프리즘에게 묻기" 로 연다.
 *
 * 사용자: "AI 기능이면 어떤 질문이든 다 답은 할 수 있어야지 — 동일유리 발주서에 관련해서는 전문가인 AI",
 *        "코멘트 주는 것들도 너무 많아서 읽지 않게 된다 — 좀 더 보기 쉽게 가시화".
 * 답은 짧은 글 한 덩어리 + 숫자 칸 · 막대 · 목록 · 화면 링크. 숫자는 서버가 DB 에서 센 값이다(/api/prism/chat).
 * 화면 아래 떠 있는 버튼은 생산 입력 · 작업의뢰서 등록의 아래 고정 저장 줄을 가려서 쓰지 않는다.
 */

export const PRISM_OPEN_EVENT = 'dg-prism:open';

/** 어디서든 대화창 열기 (질문을 같이 주면 바로 묻는다) */
export function openPrism(question?: string) {
  window.dispatchEvent(new CustomEvent(PRISM_OPEN_EVENT, { detail: question }));
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  answer?: PrismAnswer;
  krw?: number;
}

/** 처음 화면의 예시 — 어느 회사 자료에나 맞는 말만 (특정 발주서 · 현장 이름 금지) */
const SUGGESTIONS = [
  '요즘 발주 상황 어때?',
  '이번 주 생산 얼마나 했어?',
  '납기 가까운 작업의뢰서 알려 줘',
  '바로 납품할 수 있는 거 얼마나 돼?',
  '복층유리랑 강화유리 차이가 뭐야?',
];

const STORE_KEY = 'dg-prism-chat';

export default function PrismAssistant() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** 답을 못 받은 질문 — '다시 묻기' 로 그대로 다시 보낸다 */
  const [failed, setFailed] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // 새로 고침해도 대화가 남게 — 이 탭에서만 (못 쓰면 그냥 넘어간다)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE_KEY);
      if (saved) setMessages(JSON.parse(saved) as Message[]);
    } catch { /* 저장소를 못 쓰면 새 대화 */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-30))); } catch { /* 무시 */ }
  }, [messages]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const ask = useCallback(async (question: string) => {
    const q = question.trim().slice(0, MAX_QUESTION);
    if (!q || busy) return;
    const history: Message[] = [...messages, { role: 'user', text: q }];
    setMessages(history);
    setDraft('');
    setError('');
    setFailed('');
    setBusy(true);
    try {
      const turns: ChatTurn[] = history.map(m => ({ role: m.role, text: m.answer ? answerAsText(m.answer) : m.text }));
      const res = await fetch('/api/prism/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turns, path: pathname }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.answer) throw new Error(body.error ?? 'DG 프리즘이 답하지 못했습니다.');
      const answer = body.answer as PrismAnswer;
      setMessages([...history, { role: 'assistant', text: answer.reply, answer, krw: body.krw }]);
    } catch (e) {
      // 답을 못 받은 질문은 대화에서 빼고(다음 질문 때 끼지 않게) 다시 묻기로 남긴다
      setMessages(messages);
      setFailed(q);
      setError(e instanceof Error ? e.message : 'DG 프리즘이 답하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [busy, messages, pathname]);

  // 메뉴 버튼 · 다른 화면에서 여는 신호
  useEffect(() => {
    const onOpen = (e: Event) => {
      setOpen(true);
      const q = (e as CustomEvent<string | undefined>).detail;
      if (q) void ask(q);
      requestAnimationFrame(() => input.current?.focus());
    };
    window.addEventListener(PRISM_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(PRISM_OPEN_EVENT, onOpen);
  }, [ask]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const reset = () => { setMessages([]); setError(''); setFailed(''); setDraft(''); input.current?.focus(); };
  // 폰에서는 대화창이 화면을 다 덮으므로 다른 화면으로 가면 닫는다
  const onLink = () => { if (window.innerWidth < 768) setOpen(false); };

  if (!open) return null;
  return (
    <section aria-label="DG 프리즘 대화"
      className="fixed inset-0 z-50 flex flex-col bg-background shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:w-[440px] md:border-l print:hidden">
      {/* 머리 */}
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b bg-card px-4">
        <PrismMark small />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight">
            DG 프리즘
            <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/20">AI</span>
          </p>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={reset} disabled={busy}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" />새 대화
          </button>
        )}
        <button type="button" onClick={() => setOpen(false)} aria-label="대화창 닫기"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* 대화 */}
      <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div>
              <p className="text-[19px] font-bold leading-snug tracking-tight">무엇이든 물어보세요</p>
              <p className="mt-1 break-keep text-sm text-muted-foreground">
                발주 · 생산 · 납품 현황은 지금 시스템 숫자로 답합니다.
              </p>
            </div>
            <div className="space-y-1.5">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" onClick={() => void ask(s)} disabled={busy}
                  className="flex w-full items-center justify-between rounded-xl bg-card px-4 py-3 text-left text-sm font-medium ring-1 ring-border transition-colors hover:bg-brand-50 hover:ring-brand-600/30">
                  {s}<ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => m.role === 'user'
          ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap break-keep rounded-2xl rounded-tr-md bg-brand-800 px-3.5 py-2 text-sm text-white">{m.text}</p>
            </div>
          )
          : <AnswerView key={i} answer={m.answer!} krw={user?.role === 'master' ? m.krw : undefined} onLink={onLink} />)}

        {busy && (
          <div className="flex items-center gap-2.5">
            <PrismMark small />
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />현황을 보고 답을 쓰는 중입니다
            </span>
          </div>
        )}
        {failed && !busy && (
          <div className="flex justify-end">
            <p className="max-w-[85%] whitespace-pre-wrap break-keep rounded-2xl rounded-tr-md bg-brand-800/50 px-3.5 py-2 text-sm text-white">{failed}</p>
          </div>
        )}
        {error && (
          <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
            <p className="break-keep">{error}</p>
            {failed && !busy && (
              <button type="button" onClick={() => void ask(failed)}
                className="text-xs font-semibold underline underline-offset-2">다시 묻기</button>
            )}
          </div>
        )}
      </div>

      {/* 입력 */}
      <form className="shrink-0 border-t bg-card p-3" onSubmit={e => { e.preventDefault(); void ask(draft); }}>
        <div className="flex items-end gap-2 rounded-2xl bg-muted/60 px-3 py-2 ring-1 ring-border focus-within:ring-brand-600/40">
          <textarea ref={input} value={draft} rows={1} maxLength={MAX_QUESTION}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              // 한글 조합 중 Enter 는 글자 확정이다 — 그때 보내면 마지막 글자가 두 번 간다
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(draft); }
            }}
            placeholder="DG 프리즘에게 물어보기"
            className="max-h-32 min-h-6 flex-1 resize-none bg-transparent py-1 text-base leading-relaxed md:text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground" />
          <button type="submit" disabled={busy || !draft.trim()} aria-label="보내기"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-800 text-white transition-opacity disabled:opacity-30">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">Enter 보내기 · Shift+Enter 줄바꿈</p>
      </form>
    </section>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  normal: 'text-foreground',
  good: 'text-success',
  warn: 'text-amber-600',
  danger: 'text-destructive',
};
const TONE_DOT: Record<Tone, string> = {
  normal: 'bg-brand-600',
  good: 'bg-success',
  warn: 'bg-warning',
  danger: 'bg-destructive',
};

/** DG 프리즘의 답 한 덩어리 — 글은 짧게, 나머지는 숫자 칸 · 막대 · 목록 · 링크로 */
function AnswerView({ answer, krw, onLink }: { answer: PrismAnswer; krw?: number; onLink: () => void }) {
  const max = Math.max(1, ...answer.chart.map(p => p.value));
  const showValues = answer.chart.length <= 8;
  return (
    <div className="flex gap-2.5">
      <PrismMark small />
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="whitespace-pre-wrap break-keep pt-0.5 text-[14.5px] leading-relaxed">{answer.reply}</p>

        {answer.stats.length > 0 && (
          <div className={cn('grid gap-2', answer.stats.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
            {answer.stats.map((s, i) => (
              <div key={i} className="rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
                <p className="truncate text-xs text-muted-foreground">{s.label}</p>
                <p className={cn('tabular mt-0.5 text-[22px] font-bold leading-tight tracking-tight', TONE_TEXT[s.tone])}>
                  {s.value}<span className="ml-0.5 text-[13px] font-semibold text-muted-foreground">{s.unit}</span>
                </p>
              </div>
            ))}
          </div>
        )}

        {answer.chart.length > 0 && (
          <div className="rounded-xl bg-card px-3 pb-2 pt-2.5 ring-1 ring-border">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              {answer.chart_title}{answer.chart_unit && <span className="font-normal"> ({answer.chart_unit})</span>}
            </p>
            <div className="flex h-28 items-end gap-1">
              {answer.chart.map((p, i) => (
                <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                  title={`${p.label} ${p.value.toLocaleString()}${answer.chart_unit}`}>
                  {showValues && <span className="tabular text-[10px] text-muted-foreground">{p.value.toLocaleString()}</span>}
                  <div className={cn('w-full max-w-7 rounded-t-[4px]', p.value === max ? 'bg-brand-600' : 'bg-brand-600/35')}
                    style={{ height: `${Math.max(p.value > 0 ? 4 : 1, (p.value / max) * 100)}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1">
              {answer.chart.map((p, i) => (
                <span key={i} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground">{p.label}</span>
              ))}
            </div>
          </div>
        )}

        {answer.items.length > 0 && (
          <ul className="divide-y rounded-xl bg-card ring-1 ring-border">
            {answer.items.map((it, i) => (
              <li key={i} className="flex gap-2.5 px-3 py-2">
                <span className={cn('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[it.tone])} />
                <div className="min-w-0">
                  <p className="break-keep text-[13.5px] font-semibold">{it.title}</p>
                  {it.detail && <p className="break-keep text-xs text-muted-foreground">{it.detail}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}

        {(answer.links.length > 0 || krw != null) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {answer.links.filter(h => h in LINKS).map(h => (
              <Link key={h} href={h} onClick={onLink}
                className="flex items-center gap-0.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100">
                {LINKS[h]}<ChevronRight className="h-3.5 w-3.5" />
              </Link>
            ))}
            {krw != null && <span className="tabular ml-auto text-[11px] text-muted-foreground">약 {krw.toLocaleString()}원</span>}
          </div>
        )}
      </div>
    </div>
  );
}
