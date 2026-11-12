/**
 * DG 프리즘 API — 발주서 규격정리 전문가 (2.0, 2026-11-09).
 * 발주서 글(불러온 시트 전부)과 요청을 Claude 에게 보내고, 정해 둔 모양(JSON)의 계획을 받는다.
 * 계획의 종류 · 적용 규칙은 lib/erp/ai-packaging.ts.
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
import { applyPlan, buildPrompt, keysLabel, type AiPackagingRequest, type AiPlan } from '@/lib/erp/ai-packaging';

// 발주서를 읽고 깊게 생각하는 데 30초–1분 반쯤 걸린다
export const maxDuration = 300;

const MODEL = 'claude-opus-5-5';

const Range = z.object({
  sheet: z.string().describe('시트 이름 (지금 불러온 시트 중 하나)'),
  from: z.number().describe('시작 엑셀 행 (포함)'),
  to: z.number().describe('끝 엑셀 행 (포함)'),
});

const Plan = z.object({
  action: z.enum(['arrange', 'answer', 'load_sheets']).describe('arrange = 포장을 짜거나 고친다 · answer = 질문에만 답한다 · load_sheets = 다른 시트를 불러와야 한다'),
  reply: z.string().describe('사용자에게 하는 답. 질문이면 답, 작업이면 무엇을 어떻게 했는지 2–5문장 존댓말'),
  understanding: z.string().describe('발주서를 어떻게 이해했는지 — 근거가 된 시트 · 행 · 문구. 존댓말'),
  sheets: z.array(z.string()).describe('load_sheets 면 불러올 시트 전부(합칠 시트 모두). 아니면 지금 불러온 시트 그대로'),
  package_count: z.number().describe('packages 에 넣을 포장 수 (arrange 가 아니면 0)'),
  packages: z.array(z.object({
    label: z.string().describe('포장 이름 = ERP 시트 이름. 동·호가 있으면 "3동 1~3호" · "3동 4,5호"(호가 3개 이상 이어질 때만 ~), 합계 행 라벨이 있으면 그 라벨'),
    ranges: z.array(Range).describe('이 포장에 들어갈 행 범위 — 이어진 구간은 첫 행–끝 행 하나로 넓게'),
    reason: z.string().describe('이렇게 묶은 근거 한 줄 (존댓말)'),
    row_order: z.enum(['erp', 'source']).describe('포장 안 행 순서: erp = 회사 ERP 규칙(기본) · source = 발주서에 적힌 순서 그대로'),
  })).describe('싣는 순서대로 — 첫 포장이 첫 시트. arrange 가 아니면 빈 배열'),
  exclude: z.array(Range.extend({ reason: z.string() })).describe('사용자가 빼 달라고 한 품목 행. 없으면 빈 배열'),
  location_edits: z.array(z.object({
    find: z.string().describe('위치 글자에서 찾을 말'),
    replace: z.string().describe('바꿀 말 (지우려면 빈 글자)'),
    ranges: z.array(Range).describe('고칠 행 범위. 전체면 빈 배열'),
  })).describe('위치(ERP 첫 칸) 글자 고치기 요청이 있을 때만. 없으면 빈 배열'),
  product_names: z.array(z.object({ from: z.string(), to: z.string() }))
    .describe('규격정리 우측 품명(사내 · ERP 품목명) — 발주서 품명 → 사내 품명. 요청이 있거나 확실할 때만. 없으면 빈 배열'),
  cautions: z.array(z.string()).describe('사람이 확인해야 할 것만 (존댓말). 문제없는 사실은 적지 않는다'),
});

const SYSTEM = `너는 유리 가공 회사 동일유리의 **발주서 규격정리 전문가 "DG 프리즘"**이다. 업무지원부 직원이 거래처 발주서(엑셀)를
회사 ERP(바이투)에 올릴 엑셀로 바꾸는 일을 돕는다. 이 일에 대해서는 어떤 요청이든 알아듣고, 할 수 있는 것은 하고,
할 수 없는 것은 왜 안 되는지와 대신 할 방법을 말한다.

## 업무 흐름
발주서 → 규격정리 → ERP 업로드 엑셀 → (회사 ERP) → 작업의뢰서. 우리 시스템이 앞의 셋을 만든다.
- ERP 업로드 엑셀은 4열(위치 | 규 | 격 | 수량). **시트 1장 = 포장 1개 = 작업의뢰서 1장** = 현장에 한 번에 싣는 묶음이다.
  시트 순서 = 현장에 싣는 순서다. 발주서 상단 "동순서 3-4-2-1-5" 가 있으면 그 동 순서로 둔다.
- 규격정리 엑셀: 좌 = 발주서 순서 그대로, 우 = ERP 순서. 우측 품명 칸은 사내 품명으로 바꾸는 칸이다(사람이 하던 유일한 판단).
  평 열은 실제로 재(才, 303mm×303mm)다.

## 시스템이 자동으로 하는 것 (너는 정하지 않는다)
- 포장 안 행 순서(기본): 품명 블록은 발주서에 나온 순서, 블록 안은 세로 내림차순 → 가로 내림차순. 우미형은 外 블록 → 內 블록 → 발코니·하향식피난구.
  위치에 "우스텝-1, 우스텝-2" 같은 연번이 붙은 블록은 발주서 순서를 그대로 둔다.
  사용자가 "발주서 순서대로" 를 원하면 그 포장의 row_order 를 source 로 하면 된다.
- 같은 품명 + 같은 규격은 위치가 서로 다를 때만 한 줄로 합쳐 수량을 더한다(여러 호를 1~3호로 묶음). 위치가 완전히 같은 두 줄은 합치지 않는다.
- 위치 문자열: 우미형 "{동}동 {호} {타입} {층}F {실명}({內/外})" (호가 3개 이상 이어지면 ~, 아니면 콤마, 타입 접미는 알파벳순),
  합친 호들의 실명은 포괄하는 쪽. KCC형(비고에 위치가 완성돼 있음)은 비고 원문 + "구조마감" 접두 + 비고에 빠진 내판 폭.
- **가로 · 세로 · 수량 숫자는 발주서에서 읽은 그대로다. 너는 숫자를 바꾸지 못한다.** 숫자를 바꿔 달라는 요청에는
  "미리보기 표에서 직접 고칠 수 있다" 고 안내한다.

## 포장 단위를 찾는 근거 (앞의 것일수록 정확)
1. 품목 사이의 "N동 x,y호 같이 포장" 표시 행 — 그 묶음의 마지막 다음 줄에 놓여 묶음을 닫는다.
2. 상단 포장 지시문 "1,3,4동( 1,2,3호 포장,4,5호 포장),2동(…)". 같은 상단의 "※ 7차 주문서별 포장요망 (동순서 3-4-2-1-5)" 은 동순서지 포장 단위가 아니다.
3. 회색 합계 행 — 가로 · 세로 없이 수량만 있는 행은 포장 끝("※ 회색 합계 단위로 포장" 지시). 그 행의 라벨(예: "A-구간 합계")이 포장 이름이다.
   가로 칸에 "계" 가 있는 행은 보통 품명 블록 끝이지 포장 끝이 아니다. "총 계" 는 시트 총계다.
   단 상단에 "TOTAL 합계 적힌 것처럼 포장" · "합계 단위로 포장" 같은 지시가 있으면 이 "계" 행이 포장 경계다 — 아래 '층별 포장' 규칙과 함께 쓴다.
4. **위 1–3 같은 포장 지시가 없으면 한 포장으로 둔다.** 동 · 블록 · 발주번호 · 합계 행이 여러 개라는 것만으로 나누지 않는다
   (실물 ERP 대조 2026-11-10: 지시 없는 동신 · 이랜드 · 동성 발주서는 모두 한 포장이었다). 나누는 게 나아 보이면 cautions 에
   "포장 지시가 없어 한 포장으로 두었습니다 — ○○별로 나누려면 말씀해 주세요" 처럼 제안만 한다.
   "발주서별 포장요망" · "층별 포장" · "회색 합계 단위로 포장" · "TOTAL 합계 적힌 것처럼 포장" 같은 말은 지시다 — 그대로 따른다.
"동별, 라인별 포장" 같은 모호한 말은 해석을 reply 에 밝히고 다른 해석은 cautions 에 적는다.

### 층별 포장 지시가 있을 때 (2026-11-12 실물 ERP 대조)
- 한 층에 속한 "계" 덩어리들은 그 층 하나의 포장으로 합친다 — 품명 구간(GL01 · GL02 같은 다른 품명 표)에 흩어져 있어도 같은 층이면 합친다.
- 위치가 "11층~14층" 처럼 **여러 층에 걸친 덩어리**는 그 면(입면 · 방위: 북측 · 서측 · 남측 · 동측 …)이 어떻게 적혔는지로 정한다.
  · 같은 면이 다른 곳에서 **층마다 따로 "계" 로 적혀 층 포장이 되는 면**이면, 그 여러 층 덩어리는 범위의 **첫 층(가장 낮은 층) 포장에 넣는다**
    (예: 서측이 층마다 적혀 있는데 "11층~14층 서측 …" 덩어리가 하나 더 있으면 11층 포장으로). 그렇게 넣었다고 cautions 에 적는다.
  · 그 면이 **처음부터 여러 층 덩어리로만** 적혀 있으면(층마다 따로 적힌 "계" 가 없는 면) 층 포장에 넣지 않고 "계" 덩어리 하나를 포장 하나로 둔다.
    같은 위치 이름(같은 면 · 같은 창호 부호)의 "계" 덩어리가 연달아 여러 개여도 **합치지 않는다** — 발주처가 "계" 로 나눠 적은 것이 곧 포장 단위다.
  (실물 ERP 대조 2026-11-12: 층별 포장 지시 발주서에서 회사는 층마다 적힌 면의 여러 층 덩어리를 첫 층 포장에 넣고,
   여러 층 덩어리로만 적힌 면은 "계" 대로 따로 포장했다.)
- 포장 순서는 발주서에 처음 나온 순서다.

### 구역 · 위치로 골라 달라는 요청 ("○○만 따로", "○○ 빼고")
- 위치 칸은 덩어리 첫 행에만 적히고 아래 행은 비어 있는 경우가 많다. 이때 아래 행의 구역은 **그 행의 비고(상세 위치)를 먼저** 본다.
- 위치 머리는 한 구역(예: "1층 로비")인데 어떤 행의 비고가 다른 구역(예: "지하1층 …")만 가리키고 그 구역 이름이 없으면, 그 행은 위치 머리 구역으로 넣지 않는다.
  그렇게 나눈 행과 장수를 cautions 에 적는다(반대로 묶기를 원하면 말씀해 달라고).

## 사내 품명 (규격정리 우측) — 알려진 예
- 5GN+12Ar+5DURA MAX → 22T 5newGN+12AR.+5로이
- 5CL+12Ar+5DURA MAX → 22T 5CL+12Ar.+5로이
- 5GN+12Air+5DURA MAX → 22T 5newGN+12A+5로이
경향: 앞에 총두께 "22T"(유리 + 간봉 두께 합), Ar(아르곤) → AR./Ar., Air(공기) → A, DURA MAX → 로이, GN → newGN.
계약 기준이라 회사마다 다를 수 있다 — 사용자가 요청했거나 위 예와 같은 경우만 product_names 에 넣고, 추정이면 cautions 에 "추정" 이라고 적는다.

## 할 일 고르기 (action)
- 질문(몇 장? 어디가 이상해? 왜 이렇게 나눴어?)이면 **answer** — reply 에 답하고 packages 는 비운다. 숫자 질문은 발주서 글에서 직접 세어 답한다.
- 지금 불러온 시트에 없는 시트가 필요하면("1차와 2차를 합쳐서", "84A 타입 시트도 같이", "9월 7일 시트까지") **load_sheets** — sheets 에 함께 다룰 시트를 **전부** 적는다.
  시스템이 그 시트들을 불러온 뒤 같은 요청을 다시 보낸다. 이미 그 시트들이 다 불러와져 있으면 load_sheets 를 쓰지 말고 바로 arrange 한다.
- 불러온 시트가 **없으면**(사용자가 발주서만 놓고 바로 말한 경우) arrange 할 수 없다 — 요청에 맞는 시트를 load_sheets 로 부른다.
  어느 시트인지 정말 알 수 없으면 answer 로 어느 시트를 쓸지 짧게 되묻는다.
- 포장을 짜거나 고치는 요청이면 **arrange** — 지금 불러온 시트의 **모든 품목 행**을 packages 또는 exclude 에 정확히 한 번씩 넣는다.
  먼저 package_count 에 포장 수를 적고 그만큼 packages 를 채운다. 여러 시트를 합치면 한 포장에 여러 시트의 범위를 넣을 수 있다.
  ranges 는 넓게 — 이어진 구간은 첫 행–끝 행 하나로 적는다(사이의 계 · 합계 · 빈 행 · 표시 행은 시스템이 뺀다).
  요청이 직전 계획 · 지금 미리보기의 일부만 바꾸는 것이면 나머지는 그대로 둔다.
- "○○ 빼 줘" 는 exclude, "위치에서 ○○ 지워 줘 / 바꿔 줘" 는 location_edits, "품명 바꿔 줘" 는 product_names.

## 발주서 파일이 여럿일 때
- 시트 이름 앞의 ①②③ 은 발주서 파일 번호다. "첫 번째 발주서" = ①, "두 번째 발주서의 세 번째 시트" = ② 파일 시트 목록의 3) 번 시트.
- sheets · ranges 의 시트 이름은 목록에 적힌 그대로("② 5차") 쓴다. "나머지 발주서는 모든 시트" 처럼 말하면 그 파일의 시트를 전부 적는다.
- 서로 다른 현장의 발주서를 합치면 한 ERP 엑셀에 다른 현장이 섞인다 — 따를 수는 있지만 cautions 에 꼭 적는다.
  합계 · 표지 · 물량산출서 같은 시트는 품목 행이 없거나 성격이 달라 보통 합치지 않는다 — 합치라고 하면 따르되 cautions 에 적는다.

## 말투
reply · understanding · reason · cautions 는 모두 한국어 격식체 존댓말(~습니다, ~하세요)로, 짧고 분명하게 쓴다. "~요" 로 끝나는 해요체는 쓰지 않는다. 확실하지 않은 판단은 숨기지 말고 cautions 에 적는다.`;

/** 사람마다 10분에 30번까지 — 서버 인스턴스마다 따로 세는 가벼운 막이(진짜 상한은 Anthropic 콘솔의 지출 한도) */
const RECENT = new Map<string, number[]>();
function allowRequest(userId: string, now = Date.now()): boolean {
  const recent = (RECENT.get(userId) ?? []).filter(t => now - t < 10 * 60_000);
  if (recent.length >= 30) { RECENT.set(userId, recent); return false; }
  RECENT.set(userId, [...recent, now]);
  return true;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(user, 'erp:generate')) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다. 서버 환경변수 ANTHROPIC_API_KEY 를 설정하세요.' }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as AiPackagingRequest | null;
  // 배포 전에 열어 둔 화면은 예전 모양(sheet_text)으로 보낸다 — 알아듣게 알려 준다 (2026-11-09 "발주서 내용이 비어 있습니다" 로 헷갈림)
  if (body && !body.sheets && 'sheet_text' in body) {
    return NextResponse.json({ error: '화면이 이전 버전입니다. 새로고침(F5)한 뒤 발주서를 다시 업로드하고 요청하세요.' }, { status: 409 });
  }
  // 시트를 아직 안 골랐어도(sheets 빈 목록) 시트 목록이 있으면 받는다 — DG 프리즘이 말을 듣고 시트를 불러온다
  if (!body || !Array.isArray(body.sheets) || (body.sheets.length === 0 && !body.available_sheets?.length)
    || (body.sheets.length > 0 && body.sheets.every(s => !s.text || s.item_rows.length === 0))) {
    return NextResponse.json({ error: '발주서 내용이 비어 있습니다.' }, { status: 400 });
  }
  // 크레딧 보호 — 요청 크기와 사람마다 횟수에 상한을 둔다 (2026-11-10 전체 점검: 제한이 하나도 없었다).
  // 실제 가장 큰 요청(남원주 1–8차 여덟 시트 합치기)이 시트 글 약 60만 자라 그 두 배를 넘으면 거절한다.
  const textSize = body.sheets.reduce((n, s) => n + (s.text?.length ?? 0), 0) + JSON.stringify(body.previous ?? '').length;
  if (body.sheets.length > 24 || textSize > 1_200_000) {
    return NextResponse.json({ error: '한 번에 보내기에 발주서가 너무 큽니다. 시트를 나눠 요청하세요.' }, { status: 413 });
  }
  if (!allowRequest(user.id)) {
    return NextResponse.json({ error: '짧은 시간에 요청이 너무 많습니다. 몇 분 뒤 다시 시도하세요.' }, { status: 429 });
  }
  const prompt = buildPrompt(body);

  const client = new Anthropic();
  const ask = (askText: string) => client.beta.messages.parse({
    model: MODEL,
    max_tokens: 20000,
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
    // 전문가 답이 먼저다 — 깊게 생각하게 한다 (2026-11-09 "내가 만든 AI 가 전문가여야 해")
    output_config: { effort: 'high', format: betaZodOutputFormat(Plan) },
  });

  try {
    const first = await ask(prompt.ask);
    if (first.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'DG 프리즘이 이 요청을 처리하지 않았습니다. 다시 시도하거나 직접 구성하세요.' }, { status: 502 });
    }
    if (first.stop_reason === 'max_tokens' || !first.parsed_output) {
      return NextResponse.json({ error: 'DG 프리즘의 답이 중간에 끊겼습니다. 발주서가 너무 길면 시트를 나눠 시도하세요.' }, { status: 502 });
    }
    let plan: AiPlan = first.parsed_output;
    const usage = {
      input_tokens: first.usage.input_tokens, output_tokens: first.usage.output_tokens,
      cache_read: first.usage.cache_read_input_tokens ?? 0, cache_write: first.usage.cache_creation_input_tokens ?? 0,
      model: first.model,
    };

    // 스스로 검사 — 포장을 짠 답이면 품목 행이 빠지거나 겹치거나, 말한 포장 수와 목록 수가 다르면 한 번 더 묻는다.
    // (설명에는 포장 여러 개라고 쓰고 목록에는 1개만 넣은 일이 두 번 있었다) 틀린 답을 통째로 보여 주지 않는다 — 그 답에 끌려간다.
    const badness = (p: AiPlan) => {
      if (p.action !== 'arrange') return { score: 0, problems: [] as string[] };
      if (body.sheets.length === 0) {
        return { score: 1000, problems: ['아직 불러온 시트가 없는데 포장을 짰습니다. 요청에 맞는 시트를 load_sheets 로 먼저 불러오세요.'] };
      }
      const c = applyPlan(p, body.sheets);
      const problems = [
        p.package_count !== p.packages.length && `포장이 ${p.package_count}개라고 했지만 packages 목록에는 ${p.packages.length}개만 넣었습니다.`,
        c.unassigned.length > 0 && `어느 포장에도 · 뺀 목록에도 없는 품목 행 ${c.unassigned.length}개가 있습니다.`,
        c.duplicates.length > 0 && `두 포장에 겹친 행이 ${c.duplicates.length}개 있습니다.`,
        c.unknownSheets.length > 0 && `불러오지 않은 시트(${c.unknownSheets.join(', ')})를 가리켰습니다. 그 시트가 필요하면 load_sheets 를 쓰세요.`,
      ].filter((x): x is string => !!x);
      return { score: c.unassigned.length + c.duplicates.length + (p.package_count !== p.packages.length ? 1000 : 0) + c.unknownSheets.length * 1000, problems };
    };
    // 같은 말로 처음부터 다시 물으면 같은 실수를 되풀이했다(2026-11-10 시험: 제일 "피트니스 따로" — 포장 2개라고 하고 목록엔 1개,
    // 다시 물어도 그대로). 그래서 직전 답과 빠진 행 번호를 주고 **그 부분만 채우게** 하고, 그래도 틀리면 한 번 더 묻는다.
    let check = badness(plan);
    let retried = false;
    for (let attempt = 0; attempt < 2 && check.score > 0; attempt++) {
      const missing = plan.action === 'arrange' && body.sheets.length > 0 ? applyPlan(plan, body.sheets).unassigned : [];
      const fix = await ask([
        prompt.ask, '',
        '## 직전 답 (고쳐야 함)',
        JSON.stringify(plan), '',
        '## 직전 답에서 틀린 점',
        ...check.problems,
        ...(missing.length > 0 ? [`어느 포장에도 안 들어간 품목 행: ${keysLabel(missing, body.sheets.map(s => s.name))}`] : []),
        '',
        '직전 답을 바탕으로 틀린 곳만 고쳐 전체 답을 다시 써라. reply · understanding 에 적은 포장이 packages 목록에 **하나도 빠짐없이** 있어야 한다.',
        '불러온 시트의 모든 품목 행이 packages 또는 exclude 에 정확히 한 번씩 들어가야 하고, package_count 와 목록 개수가 같아야 한다.',
      ].join('\n'));
      usage.input_tokens += fix.usage.input_tokens;
      usage.output_tokens += fix.usage.output_tokens;
      usage.cache_read += fix.usage.cache_read_input_tokens ?? 0;
      usage.cache_write += fix.usage.cache_creation_input_tokens ?? 0;
      retried = true;
      if (fix.stop_reason === 'refusal' || !fix.parsed_output) break;
      const next = badness(fix.parsed_output);
      if (next.score < check.score) {
        plan = fix.parsed_output;
        check = next;
      }
    }

    return NextResponse.json({ plan, usage, retried });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'AI 키가 맞지 않습니다. ANTHROPIC_API_KEY 를 확인하세요.' }, { status: 502 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'AI 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.' }, { status: 429 });
    }
    // 연결 오류도 APIError 의 한 갈래라 먼저 거른다
    if (err instanceof Anthropic.APIConnectionError) {
      return NextResponse.json({ error: 'AI 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.' }, { status: 502 });
    }
    if (err instanceof Anthropic.APIError) {
      // 크레딧 부족 등은 400 으로 온다 — 원문을 그대로 보여 줘야 무엇을 할지 안다
      return NextResponse.json({ error: `AI 요청 실패 (${err.status}): ${err.message}` }, { status: 502 });
    }
    throw err;
  }
}
