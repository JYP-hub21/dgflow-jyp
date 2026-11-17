/**
 * DG 프리즘 대화 — 화면과 서버가 함께 쓰는 모양 (2026-11-15).
 *
 * 사용자: "AI 기능이면 어떤 질문이든 다 답은 할 수 있어야지 — 동일유리 발주서에 관련해서는 전문가인 AI"
 *        "코멘트 주는 것들도 너무 많아서 읽지 않게 된다 — 좀 더 보기 쉽게 가시화"
 * → 답은 짧은 글(reply) 하나 + 필요할 때만 숫자 칸(stats) · 막대(chart) · 목록(items) · 이어서 볼 화면(links).
 * 2026-11-17: "해 주는 일" 버튼(actions) — 엑셀 다운로드 · 날짜나 의뢰번호로 화면 열기 (lib/prism/actions.ts).
 */

export type Tone = 'normal' | 'good' | 'warn' | 'danger';

/**
 * 답 아래에 붙는 "해 주는 일" 버튼. 서버가 날짜 · 의뢰번호를 확인해서 만든다(AI 가 주소를 지어내지 못한다).
 * download 는 화면이 kind · from · to 로 정해진 엑셀 API 를 부르고, open 은 그 화면으로 간다.
 */
export type PrismAction =
  | { type: 'download'; kind: 'bokcheung' | 'weekly'; label: string; detail: string; from: string; to: string }
  | { type: 'open'; label: string; detail: string; href: string };

export interface PrismAnswer {
  reply: string;
  stats: { label: string; value: string; unit: string; tone: Tone }[];
  chart_title: string;
  chart_unit: string;
  chart: { label: string; value: number }[];
  items: { title: string; detail: string; tone: Tone }[];
  links: LinkHref[];
  /** 없을 수도 있다 — 예전에 저장된 대화 */
  actions?: PrismAction[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface PrismChatRequest {
  /** 앞선 대화 (오래된 것부터) — 마지막은 지금 질문 */
  turns: ChatTurn[];
  /** 지금 보고 있는 화면 주소 — "이 화면" 이 무엇인지 알게 */
  path?: string;
}

/** 답에 붙일 수 있는 화면 — 없는 주소를 지어내지 않게 목록에서만 고른다 */
export const LINKS = {
  '/dashboard': '대시보드',
  '/purchase-orders': '발주서',
  '/purchase-orders/new': '발주서 올리기',
  '/erp-upload': 'ERP 업로드',
  '/work-orders/receive': '작업의뢰서 등록',
  '/work-orders': '작업의뢰서',
  '/production': '생산 현황',
  '/production?view=remaining': '남은 품목',
  '/production/report': '생산일지',
  '/production/report?view=bokcheung': '복층생산일지',
  '/production/report?view=weekly': '주간생산일지',
  '/deliveries': '납품',
  '/deliveries?view=stock': '미납품 재고',
} as const;
export type LinkHref = keyof typeof LINKS;
export const LINK_HREFS = Object.keys(LINKS) as [LinkHref, ...LinkHref[]];

export const MAX_QUESTION = 2000;
export const MAX_TURNS = 16;

/** 앞선 답을 다음 질문 때 AI 에게 다시 줄 글 — 목록 · 숫자까지 있어야 "그중에 제일 급한 건?" 을 알아듣는다 */
export function answerAsText(a: PrismAnswer): string {
  const lines = [a.reply];
  if (a.stats.length) lines.push(a.stats.map(s => `${s.label} ${s.value}${s.unit}`).join(' · '));
  if (a.chart.length) lines.push(`${a.chart_title}: ${a.chart.map(p => `${p.label} ${p.value}${a.chart_unit}`).join(', ')}`);
  for (const it of a.items) lines.push(`- ${it.title}${it.detail ? ` — ${it.detail}` : ''}`);
  for (const act of a.actions ?? []) lines.push(`[버튼을 드렸음: ${act.label} · ${act.detail}]`);
  return lines.join('\n');
}

/** 받은 대화가 말이 되는지 — 아니면 까닭 */
export function checkTurns(turns: unknown): string | null {
  if (!Array.isArray(turns) || turns.length === 0) return '질문이 비어 있습니다.';
  if (turns.length > MAX_TURNS * 2) return '대화가 너무 깁니다. 새 대화를 시작하세요.';
  for (const t of turns) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant') || typeof t.text !== 'string') return '대화 모양이 맞지 않습니다.';
    if (t.text.length > 6000) return '한 번에 보내는 글이 너무 깁니다.';
  }
  const last = turns[turns.length - 1] as ChatTurn;
  if (last.role !== 'user' || !last.text.trim()) return '질문이 비어 있습니다.';
  if (last.text.length > MAX_QUESTION) return `질문은 ${MAX_QUESTION.toLocaleString()}자까지 쓸 수 있습니다.`;
  return null;
}

/** 대화를 API 에 보낼 모양으로 — 최근 것만, user 로 시작하고 같은 쪽이 이어지면 합친다 */
export function toApiMessages(turns: ChatTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  const recent = turns.slice(-MAX_TURNS);
  while (recent.length && recent[0].role !== 'user') recent.shift();
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of recent) {
    const text = t.text.trim() || '(빈 글)';
    const prev = out[out.length - 1];
    if (prev && prev.role === t.role) prev.content += `\n\n${text}`;
    else out.push({ role: t.role, content: text });
  }
  return out;
}
