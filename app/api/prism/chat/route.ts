/**
 * DG 프리즘 대화 API (2026-11-15) — 어떤 질문이든 답하고, 동일유리 발주서 업무는 전문가로 답한다.
 *
 * 질문마다 서버가 회사 현황(발주 건 · 작업의뢰서 · 생산 · 납품)을 DB 에서 세어 함께 준다 — 숫자는 서버가 센 값이다.
 * 답은 정해 둔 모양(짧은 글 + 숫자 칸 · 막대 · 목록 · 화면 링크)으로 받아 화면이 그림으로 보인다.
 * 2026-11-17 ("좀 고도화된 질문도 … 이런 거 다 되게"):
 *  - 현황 글에 없는 것(지난달 · 특정 기간 · 월별 · 호기별 실적, 특정 의뢰서)은 AI 가 조회 도구로 직접 찾아본다 (lib/prism/tools.ts, 읽기만).
 *  - "다운로드해 줘 · 열어 줘" 는 AI 가 무엇을 · 어느 날짜로 할지만 고르고, 서버가 확인해 버튼으로 준다 (lib/prism/actions.ts).
 * 발주서 파일을 보고 하는 일(포장 구성 등)은 ERP 업로드 화면의 DG 프리즘(/api/erp/ai-packaging)이 맡는다.
 *
 * API 키는 서버 환경변수 ANTHROPIC_API_KEY 에만 둔다. 키가 없으면 503.
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { getCurrentUser } from '@/lib/auth/get-user';
import { estimateKrw } from '@/lib/erp/ai-packaging';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { ACTION_KINDS, resolveActions, wantedNumbers } from '@/lib/prism/actions';
import { checkTurns, LINK_HREFS, LINKS, toApiMessages, type PrismAnswer, type PrismChatRequest } from '@/lib/prism/chat';
import { PRISM_KNOWLEDGE } from '@/lib/prism/knowledge';
import { snapshotText } from '@/lib/prism/snapshot';
import { loadSnapshot } from '@/lib/prism/snapshot-store';
import { dataRangeText, PRISM_TOOLS, productionDataRange, runPrismTool, workOrderIds } from '@/lib/prism/tools';

export const maxDuration = 120;

const MODEL = 'claude-opus-5-5';

const Tone = z.enum(['normal', 'good', 'warn', 'danger']);
const Answer = z.object({
  reply: z.string().describe('핵심부터 1–3문장 존댓말. 일반 질문이면 그 답'),
  stats: z.array(z.object({
    label: z.string().describe('짧은 이름 (예: 진행 중 발주 건)'),
    value: z.string().describe('숫자만, 쉼표 포함 (예: 1,240)'),
    unit: z.string().describe('건 · 조 · M² · % 등, 없으면 빈 글'),
    tone: Tone,
  })).describe('현황 질문일 때 한눈에 볼 숫자 0–4개, 아니면 빈 배열'),
  chart_title: z.string().describe('막대 제목, 막대가 없으면 빈 글'),
  chart_unit: z.string().describe('막대 값 단위, 없으면 빈 글'),
  chart: z.array(z.object({ label: z.string(), value: z.number() }))
    .describe('추이 · 비교를 막대로 보일 때만 최대 14개, 아니면 빈 배열'),
  items: z.array(z.object({ title: z.string(), detail: z.string(), tone: Tone }))
    .describe('꼭 짚을 목록이 있을 때만 최대 6개, 아니면 빈 배열'),
  links: z.array(z.enum(LINK_HREFS)).describe('이어서 볼 화면 0–2개'),
  actions: z.array(z.object({
    kind: z.enum(ACTION_KINDS),
    from: z.string().describe('YYYY-MM-DD — 기간의 첫 날, 하루 · 한 주만 가리킬 때도 여기에. 안 쓰면 빈 글'),
    to: z.string().describe('YYYY-MM-DD — 기간의 끝 날. 안 쓰면 빈 글'),
    query: z.string().describe('의뢰번호나 검색할 말. 안 쓰면 빈 글'),
  })).describe('엑셀 다운로드 · 화면 열기를 부탁받았을 때만 0–3개, 아니면 빈 배열'),
});

/** 한 질문에 AI 를 부르는 횟수 한도 — 조회 도구를 쓰면 한 번씩 더 부른다 */
const MAX_STEPS = 5;

/** 사람마다 10분에 40번까지 — 서버 인스턴스마다 따로 세는 가벼운 막이(진짜 상한은 Anthropic 콘솔의 지출 한도) */
const RECENT = new Map<string, number[]>();
function allowRequest(userId: string, now = Date.now()): boolean {
  const recent = (RECENT.get(userId) ?? []).filter(t => now - t < 10 * 60_000);
  if (recent.length >= 40) { RECENT.set(userId, recent); return false; }
  RECENT.set(userId, [...recent, now]);
  return true;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다. 서버 환경변수 ANTHROPIC_API_KEY 를 설정하세요.' }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as PrismChatRequest | null;
  const bad = checkTurns(body?.turns);
  if (bad || !body) return NextResponse.json({ error: bad ?? '질문이 비어 있습니다.' }, { status: 400 });
  if (!allowRequest(user.id)) {
    return NextResponse.json({ error: '짧은 시간에 질문이 너무 많습니다. 몇 분 뒤 다시 시도하세요.' }, { status: 429 });
  }

  const snapshot = snapshotText(await loadSnapshot(user));
  const here = typeof body.path === 'string' ? body.path.slice(0, 200) : '';
  const contextHead = [
    '# 지금 시스템 현황 (질문할 때마다 서버가 DB 에서 센 값)',
    snapshot,
    '',
    `# 묻는 사람: ${user.name}${user.department ? ` (${user.department}${user.position ? ` ${user.position}` : ''})` : ''}`,
    here ? `지금 보고 있는 화면: ${here}` : '',
    `# 고를 수 있는 화면 링크: ${Object.entries(LINKS).map(([h, l]) => `${h} = ${l}`).join(' · ')}`,
  ].filter(Boolean).join('\n');

  const service = createServiceRoleClient();
  const range = await productionDataRange(service).catch(() => ({ from: null, to: null, partialBefore: null }));
  const context = [
    contextHead,
    `# 생산 기록이 들어 있는 기간: ${dataRangeText(range)}`,
  ].join('\n');

  const client = new Anthropic();
  try {
    const messages: Anthropic.Beta.BetaMessageParam[] = toApiMessages(body.turns);
    const usage = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0 };
    let parsed: z.infer<typeof Answer> | null = null;
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [
          // 바탕 지식은 늘 같다 — 캐시해 두면 두 번째 질문부터 싸다
          { type: 'text', text: PRISM_KNOWLEDGE, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: context },
        ],
        messages,
        tools: PRISM_TOOLS as Anthropic.Beta.BetaTool[],
        // 가벼운 질문에 30초씩 기다리게 하지 않는다 — 생각은 짧게
        output_config: { effort: 'low', format: betaZodOutputFormat(Answer) },
      });
      usage.input_tokens += res.usage.input_tokens;
      usage.output_tokens += res.usage.output_tokens;
      usage.cache_read += res.usage.cache_read_input_tokens ?? 0;
      usage.cache_write += res.usage.cache_creation_input_tokens ?? 0;
      if (res.stop_reason === 'refusal') {
        return NextResponse.json({ error: 'DG 프리즘이 이 질문에는 답하지 않았습니다. 다르게 물어보세요.' }, { status: 502 });
      }
      // 조회 도구를 불렀으면 돌려서 결과를 주고 다시 묻는다
      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason === 'tool_use' && calls.length > 0) {
        const results = await Promise.all(calls.map(async (c): Promise<Anthropic.Beta.BetaToolResultBlockParam> => ({
          type: 'tool_result', tool_use_id: c.id, content: await runPrismTool(c.name, c.input, { user, service }),
        })));
        messages.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] }, { role: 'user', content: results });
        continue;
      }
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('');
      try { parsed = Answer.parse(JSON.parse(text)); } catch { parsed = null; }
      break;
    }
    if (!parsed) {
      return NextResponse.json({ error: 'DG 프리즘의 답이 중간에 끊겼습니다. 다시 시도하세요.' }, { status: 502 });
    }

    // "해 주는 일" — AI 가 고른 것을 확인해 버튼으로. 못 만드는 것은 까닭을 답 끝에 붙인다
    const { actions: rawActions, ...rest } = parsed;
    const numbers = wantedNumbers(rawActions);
    const { actions, notes } = resolveActions(rawActions, {
      dataFrom: range.from, dataTo: range.to,
      workOrders: numbers.length > 0 ? await workOrderIds(service, numbers) : new Map(),
      canProduction: hasPermission(user, 'production:view'),
    });
    const answer: PrismAnswer = { ...rest, reply: [rest.reply, ...notes].filter(Boolean).join('\n'), actions };
    return NextResponse.json({ answer, krw: estimateKrw(usage) });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'AI 키가 맞지 않습니다. ANTHROPIC_API_KEY 를 확인하세요.' }, { status: 502 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'AI 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.' }, { status: 429 });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return NextResponse.json({ error: 'AI 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.' }, { status: 502 });
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI 요청 실패 (${err.status}): ${err.message}` }, { status: 502 });
    }
    throw err;
  }
}
