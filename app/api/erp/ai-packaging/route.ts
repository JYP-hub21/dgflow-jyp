/**
 * AI 포장 제안 API — 발주서 글을 Claude 에게 보내고, 포장(행 범위) · 순서 제안을 정해 둔 모양(JSON)으로 받는다.
 *
 * API 키는 서버 환경변수 ANTHROPIC_API_KEY 에만 둔다 (브라우저로 절대 보내지 않는다 · 저장소에 올리지 않는다).
 * 키가 없으면 503 으로 알리고 화면은 AI 없이 그대로 쓴다.
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { applySuggestion, buildPrompt, rowRangesText, type AiPackagingRequest, type AiPackagingSuggestion } from '@/lib/erp/ai-packaging';

// AI 가 발주서를 읽고 생각하는 데 30초–1분쯤 걸린다
export const maxDuration = 300;

const MODEL = 'claude-opus-5-5';

const Suggestion = z.object({
  understanding: z.string().describe('이 발주서의 포장 · 순서를 어떻게 이해했는지 2–4문장. 근거가 된 행 번호와 문구를 적는다.'),
  package_count: z.number().describe('packages 배열에 넣을 포장 개수. understanding 에서 말한 포장 수와 같아야 한다'),
  packages: z.array(z.object({
    label: z.string().describe('포장 이름. 동·호가 있으면 "3동 1~3호" · "3동 4,5호" 꼴(호가 3개 이상 이어질 때만 ~, 아니면 콤마), 합계 행에 라벨이 있으면 그 라벨'),
    ranges: z.array(z.object({
      from: z.number().describe('시작 행 번호 (엑셀 행, 포함)'),
      to: z.number().describe('끝 행 번호 (엑셀 행, 포함)'),
    })).describe('이 포장에 들어갈 품목 행 범위들'),
    reason: z.string().describe('이렇게 묶은 근거 한 줄 (발주서 몇 행의 어떤 문구, 또는 사용자 지시)'),
  })).describe('ERP 시트 순서대로 — 첫 포장이 첫 시트'),
  cautions: z.array(z.string()).describe('사람이 확인해야 할 것만. 문제없이 맞는 것(합계 일치 등)은 적지 않는다. 없으면 빈 배열'),
});

const SYSTEM = `너는 유리 가공 회사 동일유리의 업무지원부를 돕는다. 거래처가 보낸 유리 발주서(엑셀 시트)를 읽고,
회사 ERP 에 올릴 엑셀을 어떻게 나눌지(포장)와 어떤 순서로 둘지 제안한다.

## ERP 업로드 엑셀
- 시트 1장 = 포장 1개 = 작업의뢰서 1장. 현장에 실을 때 한 묶음이다.
- 시트 순서 = 현장에 싣는 순서. 발주서 상단에 "동순서 3-4-2-1-5" 처럼 적혀 있으면 그 동 순서로 시트를 둔다.
  순서 지시가 없으면 발주서에 나온 순서를 따른다.
- 시트 안의 행 순서 · 같은 규격 합치기 · 위치 문자열은 시스템 규칙이 만든다. 너는 정하지 않는다.

## 포장 단위를 찾는 근거 (앞의 것일수록 정확하다)
1. 품목 사이의 "N동 x,y호 같이 포장" 같은 표시 행 — 그 포장 묶음의 마지막 다음 줄에 놓여 묶음을 닫는다.
2. 상단 포장 지시문 — 예: "1,3,4동( 1,2,3호 포장,4,5호 포장),2동(…)". 같은 상단에 "※ 7차 주문서별 포장요망 (동순서 3-4-2-1-5)"
   처럼 "포장" 이 들어간 다른 줄이 있을 수 있다. 그 줄은 동순서이지 포장 단위가 아니다.
3. 회색 합계 행 — 가로 · 세로 없이 수량만 있는 행은 포장 끝이다. 그 행에 라벨(예: "A-구간 합계")이 있으면 포장 이름으로 쓴다.
   가로 칸에 "계" 가 있는 행은 품명 블록의 끝이지 포장 끝이 아니다. "총 계" 는 시트 총계다.
4. 위 근거가 없으면 동 · 호 조합으로 나눈다. 그것도 없으면 한 포장으로 둔다.

## 규칙
- 사용자에게서 받은 "품목 행" 목록의 모든 행이 정확히 한 포장에 들어가야 한다. 한 행을 두 포장에 넣지 마라.
- packages 목록에는 나눈 포장을 **하나도 빠짐없이 전부** 넣는다. 먼저 package_count 에 포장 수를 적고, 그 수만큼 목록을 채운다.
  ranges 는 넓게 적는다: 포장 하나가 발주서에서 이어진 구간이면 그 구간의 첫 행부터 끝 행까지 **범위 하나**로 적는다.
  사이에 낀 계 · 합계 · 빈 행 · 포장 표시 행을 피하려고 범위를 쪼개지 마라 — 시스템이 품목 행만 골라 담는다.
  범위를 나누는 것은 다른 포장의 품목 행이 사이에 끼어 있을 때뿐이다.
- 사용자 요청이 있으면 그 뜻을 우선한다. 사용자는 포장을 어떻게 할지 길게 · 말로 적을 수 있다
  (예: "1~3호는 한 포장, 발코니는 따로 빼고 5동을 맨 앞에"). 행 번호 · 동 · 호 · 품명 · 층 무엇으로 말해도 그 뜻대로 행을 골라 묶는다.
  이어서 고치는 요청이면 직전 제안을 바탕으로 고친다. 지시가 발주서 내용과 어긋나거나, 시트 안 행 순서처럼 네가 정할 수 없는 것을
  바꾸라는 것이면 따를 수 있는 만큼만 따르고 cautions 에 적는다.
- 확실하지 않은 판단은 숨기지 말고 cautions 에 적는다. 발주서 합계가 맞지 않아 보이는 것도 적는다.
  합계가 맞는 것처럼 문제없는 사실은 cautions 에 적지 않는다 — 사람이 볼 경고만 남긴다.
- 너는 지금 고른 **시트(차수) 하나만** 받는다. 다른 시트를 합치거나 함께 처리하라는 요청이면 따를 수 없다고 짧게 알리고,
  받은 시트로 할 수 있는 만큼만 짠다.
- 할 수 없는 요청은 무엇이 안 되는지와 대신 할 수 있는 방법을 함께 적는다.
- 모든 글(understanding · reason · cautions)은 한국어 **존댓말(~요, ~습니다)** 로, 짧고 분명하게 쓴다. "~다 · ~한다" 같은 반말 투는 쓰지 않는다.`;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'erp:generate')) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다. 서버 환경변수 ANTHROPIC_API_KEY 를 넣어 주세요.' }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as AiPackagingRequest | null;
  if (!body?.sheet_text || !Array.isArray(body.item_rows) || body.item_rows.length === 0) {
    return NextResponse.json({ error: '발주서 내용이 비어 있습니다.' }, { status: 400 });
  }

  const prompt = buildPrompt(body);

  const client = new Anthropic();
  const ask = (askText: string, effort: 'medium' | 'high' = 'medium') => client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // 안전 분류기가 드물게 거절하면 서버가 알아서 다른 모델로 다시 시도한다
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        // 발주서 원문은 이어서 고쳐도 같다 — 캐시해 두면 두 번째 요청부터 원문 읽는 값이 20분의 1로 준다
        { type: 'text', text: prompt.sheet, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: askText },
      ],
    }],
    output_config: { effort, format: betaZodOutputFormat(Suggestion) },
  });

  try {
    const first = await ask(prompt.ask);
    if (first.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'AI 가 이 요청을 처리하지 않았습니다. 다시 시도하거나 직접 짜 주세요.' }, { status: 502 });
    }
    if (first.stop_reason === 'max_tokens' || !first.parsed_output) {
      return NextResponse.json({ error: 'AI 답이 중간에 끊겼습니다. 발주서가 너무 길면 시트를 나눠 시도해 주세요.' }, { status: 502 });
    }
    let suggestion: AiPackagingSuggestion = first.parsed_output;
    const usage = {
      input_tokens: first.usage.input_tokens, output_tokens: first.usage.output_tokens,
      cache_read: first.usage.cache_read_input_tokens ?? 0, cache_write: first.usage.cache_creation_input_tokens ?? 0,
      model: first.model,
    };

    // 스스로 검사 — 품목 행이 빠지거나 두 포장에 겹치거나, 말한 포장 수와 목록 수가 다르면 한 번 더 묻는다.
    // (설명에는 포장 여러 개라고 쓰고 목록에는 1개만 넣은 일이 두 번 있었다, 2026-11-09)
    // 다시 물을 때는 틀린 첫 답을 통째로 보여 주지 않는다 — 그 답에 끌려가 같은 실수를 되풀이했다. 더 깊게 생각하게(high) 묻는다.
    const badness = (sg: AiPackagingSuggestion) => {
      const c = applySuggestion(sg, body.item_rows);
      const countGap = typeof sg.package_count === 'number' && sg.package_count !== sg.packages.length ? 1 : 0;
      return { c, countGap, score: c.unassigned.length + c.duplicates.length + countGap * 1000 };
    };
    const first1 = badness(suggestion);
    let retried = false;
    if (first1.score > 0) {
      const problems = [
        first1.countGap > 0 && `포장이 ${suggestion.package_count}개라고 했지만 packages 목록에는 ${suggestion.packages.length}개(${suggestion.packages.map(x => x.label).join(', ')})만 넣었다.`,
        first1.c.unassigned.length > 0 && `어느 포장에도 안 들어간 품목 행 ${first1.c.unassigned.length}개: ${rowRangesText(first1.c.unassigned)}`,
        first1.c.duplicates.length > 0 && `두 포장에 겹친 행: ${rowRangesText(first1.c.duplicates)}`,
      ].filter(Boolean).join('\n');
      const second = await ask([
        prompt.ask, '',
        '## 첫 답에서 틀린 점',
        problems,
        '처음부터 다시 판단해, 나눈 포장을 packages 목록에 하나도 빠짐없이 전부 넣어라. 모든 품목 행이 정확히 한 포장에 들어가야 하고, package_count 와 목록 개수가 같아야 한다.',
      ].join('\n'), 'high');
      usage.input_tokens += second.usage.input_tokens;
      usage.output_tokens += second.usage.output_tokens;
      usage.cache_read += second.usage.cache_read_input_tokens ?? 0;
      usage.cache_write += second.usage.cache_creation_input_tokens ?? 0;
      retried = true;
      // 고친 답이 더 나을 때만 바꾼다
      if (second.stop_reason !== 'refusal' && second.parsed_output && badness(second.parsed_output).score < first1.score) {
        suggestion = second.parsed_output;
      }
    }

    return NextResponse.json({ suggestion, usage, retried });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'AI 키가 맞지 않습니다. ANTHROPIC_API_KEY 를 확인해 주세요.' }, { status: 502 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'AI 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.' }, { status: 429 });
    }
    // 연결 오류도 APIError 의 한 갈래라 먼저 거른다
    if (err instanceof Anthropic.APIConnectionError) {
      return NextResponse.json({ error: 'AI 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.' }, { status: 502 });
    }
    if (err instanceof Anthropic.APIError) {
      // 크레딧 부족 등은 400 으로 온다 — 원문을 그대로 보여 줘야 무엇을 할지 안다
      return NextResponse.json({ error: `AI 요청 실패 (${err.status}): ${err.message}` }, { status: 502 });
    }
    throw err;
  }
}
