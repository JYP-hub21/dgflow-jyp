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
import { applySuggestion, rowRangesText, type AiPackagingRequest, type AiPackagingSuggestion } from '@/lib/erp/ai-packaging';

// AI 가 발주서를 읽고 생각하는 데 30초–1분쯤 걸린다
export const maxDuration = 300;

const MODEL = 'claude-opus-5-5';

const Suggestion = z.object({
  understanding: z.string().describe('이 발주서의 포장 · 순서를 어떻게 이해했는지 2–4문장. 근거가 된 행 번호와 문구를 적는다.'),
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
  ranges 는 연속된 행 범위로 적되, 범위 안의 합계 · 머리글 행은 시스템이 알아서 뺀다.
- 사용자 지시가 있으면 그 뜻을 우선한다. 지시가 발주서 내용과 어긋나거나, 시트 안 행 순서처럼 네가 정할 수 없는 것을
  바꾸라는 것이면 따를 수 있는 만큼만 따르고 cautions 에 적는다.
- 확실하지 않은 판단은 숨기지 말고 cautions 에 적는다. 발주서 합계가 맞지 않아 보이는 것도 적는다.
  합계가 맞는 것처럼 문제없는 사실은 cautions 에 적지 않는다 — 사람이 볼 경고만 남긴다.
- 모든 글은 한국어로, 짧고 분명하게 쓴다.`;

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

  const userText = [
    `거래처: ${body.customer_name || '(못 읽음)'} / 현장: ${body.site_name || '(못 읽음)'} / 시트: ${body.sheet_name}`,
    `품목 행 (이 행들을 빠짐없이 포장에 넣는다): ${rowRangesText(body.item_rows)}`,
    body.instruction?.trim() ? `사용자 지시: ${body.instruction.trim().slice(0, 1000)}` : '사용자 지시: 없음',
    '',
    '발주서 시트 (한 줄 = 엑셀 한 행, "행번호| 칸 | 칸 …"):',
    body.sheet_text,
  ].join('\n');

  const client = new Anthropic();
  const ask = (text: string) => client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // 안전 분류기가 드물게 거절하면 서버가 알아서 다른 모델로 다시 시도한다
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: text }],
    output_config: { effort: 'medium', format: betaZodOutputFormat(Suggestion) },
  });

  try {
    const first = await ask(userText);
    if (first.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'AI 가 이 요청을 처리하지 않았습니다. 다시 시도하거나 직접 짜 주세요.' }, { status: 502 });
    }
    if (first.stop_reason === 'max_tokens' || !first.parsed_output) {
      return NextResponse.json({ error: 'AI 답이 중간에 끊겼습니다. 발주서가 너무 길면 시트를 나눠 시도해 주세요.' }, { status: 502 });
    }
    let suggestion: AiPackagingSuggestion = first.parsed_output;
    const usage = { input_tokens: first.usage.input_tokens, output_tokens: first.usage.output_tokens, model: first.model };

    // 스스로 검사 — 품목 행이 빠지거나 두 포장에 겹치면 그 행을 짚어 한 번 더 묻는다
    // (설명에는 "포장 2개" 라고 쓰고 목록에는 1개만 넣은 일이 있었다, 2026-11-09)
    const check = applySuggestion(suggestion, body.item_rows);
    let retried = false;
    if (check.unassigned.length > 0 || check.duplicates.length > 0) {
      const problems = [
        check.unassigned.length > 0 && `어느 포장에도 안 들어간 품목 행: ${rowRangesText(check.unassigned)}`,
        check.duplicates.length > 0 && `두 포장에 겹친 행: ${rowRangesText(check.duplicates)}`,
      ].filter(Boolean).join('\n');
      const second = await ask([
        userText, '',
        '## 첫 답 검사 결과',
        `첫 답: ${JSON.stringify(suggestion)}`,
        `문제:\n${problems}`,
        '모든 품목 행이 정확히 한 포장에 들어가게 고쳐서 전체 답을 다시 써라. understanding 의 설명과 packages 목록이 서로 맞아야 한다.',
      ].join('\n'));
      usage.input_tokens += second.usage.input_tokens;
      usage.output_tokens += second.usage.output_tokens;
      retried = true;
      if (second.stop_reason !== 'refusal' && second.parsed_output) {
        const again = applySuggestion(second.parsed_output, body.item_rows);
        // 고친 답이 더 나을 때만 바꾼다
        if (again.unassigned.length + again.duplicates.length < check.unassigned.length + check.duplicates.length) {
          suggestion = second.parsed_output;
        }
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
