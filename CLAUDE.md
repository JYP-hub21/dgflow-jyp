# DG-Flow - 동일유리 주문관리 시스템

## 프로젝트 개요
- **프로젝트명:** DG-Flow (Dongil Glass Flow)
- **목적:** 동일유리(주) 주문→승인→ERP→생산 전체 워크플로우 디지털화
- **기술 스택:** Next.js 16 (App Router, Turbopack) + Supabase (PostgreSQL/Auth) + Vercel
- **UI:** shadcn/ui (@base-ui) + Tailwind CSS v4
- **근거 문서:** `data/PRD.md` (요구사항), `data/TASK.md` (태스크 관리),
  `data/ERP-RULES.md` (발주서→ERP 변환 규칙 — 실물 대조 검증 결과)
- **규모:** 18 페이지, 22 API, 23 DB 테이블, 135 소스 파일 (2026-10-22 기준)

## 구현 완료 현황

### 주문 워크플로우는 2026-10-13 자로 걷어냈다
주문 작성 → 고객승인 → 검토 → 최종승인 → 작업의뢰서 자동 생성의 14단계 흐름과
그 화면(주문 관리·검토·승인·고객 승인 링크·알림·발주서에서 작업의뢰서 직접 만들기)은
**실제 업무에서 쓰지 않아** 삭제했다. 실제 업무는 아래 "전체 흐름" 의 두 토막뿐이다.
DB 테이블(`dgflow_orders`, `dgflow_notifications` 등)과 `types/order-status.ts` ·
`lib/` 의 파서·빌더는 그대로 남아 있다 (테스트와 작업의뢰서 라벨이 쓴다).
되살리려면 git 이력에서 꺼낸다.

메뉴는 업무 순서대로: 대시보드 → 발주서 → ERP 업로드 → 작업의뢰서 등록 → 작업의뢰서 → 생산 현황 → 마스터·사용자 관리.

### 발주서 파이프라인 (2026-10-22)
메일로 오가던 발주서를 **발주 건** 하나로 묶어 접수부터 생산 완료까지 따라간다 (`/purchase-orders`).
임원진 요구: "발주서를 보냈는데 확인했는지, 작업 중인지 알 수가 없다" + "ERP 앞뒤가 끊긴다".

- **접수:** 사내 직원이 발주서를 올리고 **담당자를 지목**한다(등록자가 고른다). 접수번호 `P{YYMMDD}-{NN}`
- **확인:** **담당자 본인**이 파일을 받거나 ERP 변환 화면에서 열면 그 시각이 "확인" 이다.
  다른 사람이 열면 기록만 남는다. 등록자 화면에 `확인함 · 이름 · 시각` 이 보인다
- **ERP 변환:** 건에서 "ERP 엑셀 만들기" → `/erp-upload?po=` 가 저장소의 발주서를 바로 연다.
  "P…에 저장" 하면 ERP 엑셀 · 규격정리 파일과 **포장(시트)별 행**을 건에 붙인다
- **작업의뢰서 연결:** **포장 1개 = 작업의뢰서 1장** (사용자 확인). ERP 작업의뢰서에는 우리 번호를
  적을 칸이 없어 **규격(가로×세로)별 수량 합**으로 짝을 찾고 대조한다 (`lib/purchase-order/match.ts`).
  위치 문구는 ERP 가 다시 써서 비교하지 않는다. 복층은 같은 규격 목록이 품명 블록(外/內)마다
  되풀이돼 모든 규격이 k 배면 일치로 친다. **자동으로 잇지 않는다** — 후보만 보이고 사람이 누른다
- **단계:** 접수 · 확인 · ERP 엑셀은 저장(`stage`), 작업의뢰서 받는 중 · 생산 중 · 완료는 연결된
  작업의뢰서의 생산 수량에서 **계산**한다 (`lib/purchase-order/stage.ts`). 한 단계에 오래 머물면 "n일째"
- **파일:** Supabase 무료 요금제(파일 50MB · 전체 1GB)라 브라우저가 저장소에 **45MB 조각**으로 직접 올린다
  (Vercel 은 요청당 4.5MB). 151MB KCC 발주서가 4조각, 업로드 약 46초. 마스터는 목록에서 사용량을 보고
  끝난 건(완료 · 취소)의 파일을 정리할 수 있다 (기록은 남고 `purged_at` 만 찍힌다)
- 대시보드 "발주서 흐름" — 단계별 건수 · 멈춘 건. 사이드바 배지 — 나에게 온 미확인 건수

### 구현된 기능
- **엑셀 발주서 업로드:** 6종 양식 자동 파싱 (기본정보+품목), 품명 병합 셀 대응
- **ERP 업로드 엑셀 생성:** 발주서 업로드 → 포장 단위별 시트(`위치|가로|세로|수량` 4열) 생성/다운로드
  (`/erp-upload`). **거래처 두 곳의 실물 ERP 200행과 전수 대조 검증**
  (우미 남원주7차 136행 — **위치 문자열까지 전부 일치** + KCC 여의도 64행).
  포장 단위는 발주서 합계 행 → "같이 포장" 표시행 → 포장 지시문 → 동별 추론 순으로 찾고,
  화면에서 바꿀 수 있다. 포장 개별 다운로드도 가능
- **검산:** 발주서가 적어 둔 블록 `계`·포장 `합계`·`총계` 와 우리 계산을 대조해 화면 맨 위에 표시.
  파서가 완벽하지 않아도 "제대로 읽었는지" 는 발주서 자신에게 물어볼 수 있다
- **ERP 미리보기 편집:** 위치·가로·세로·수량을 표에서 직접 수정, 행 추가·삭제·이동, 자동값 되돌리기
- **양식 프로파일:** 열 지정을 거래처별로 저장(`dgflow_order_form_profiles`)해 다음 발주서에 자동 적용.
  **거래처나 현장이 맞아야만 적용한다** — 여러 거래처가 같은 표준 양식을 쓰므로 헤더 지문만으로는
  구분이 안 된다(우미 13행 / KCC 12행). 적용 후 품목이 0건이면 자동 판정으로 되돌린다
- **포장 직접 짜기:** 발주서의 포장 표기가 애매하면 사원이 행을 골라 포장을 구성한다.
  자동 결과에서 시작하고, 미배정 행을 붉게 표시해 절대 잃어버리지 않게 한다.
  빠른 선택(품명 블록·동·동호·층·위치)으로 덩어리째 고를 수 있다.
  행을 누른 채 끌거나 Shift+클릭으로 범위를 고르고, "새 포장으로 만들기" 로 한 번에 묶는다
- **현장별 포장 방식 저장:** 짠 구성을 `dgflow_site_packaging_rules` 에 저장해 다음 차수에 재사용.
  **행 번호가 아니라 묶은 기준(동·호 / 품명 블록)을 저장**하므로 행이 밀려도 적용된다.
  기준을 못 뽑아내면 `reusable = false` 로 남기고 다음 차수에 적용하지 않는다
- **규격정리 엑셀 생성:** 좌=발주서 순서 / 우=ERP 순서 2단 구조. 사원은 품명만 ERP 품목명으로 고치면 된다
- **작업의뢰서 상세:** 전체 진행률 바, 품목별 현황, 복층/재단 이력 통합
- **작업의뢰서 등록:** ERP 엑셀·PDF 업로드 → 검산 → 저장 (`/work-orders/receive`). 위 "전체 흐름" 참고
- **생산실적 일괄 입력:** 전체 저장, 전량완료, 일별 생산 이력, 주/야간·호기.
  **공장에서 폰으로 쓴다** — 품목당 카드, 48px 입력칸, 숫자 키패드, 행마다 전량 버튼,
  완료 품목은 접어서 맨 아래로. 사이드바는 폰에서 서랍이다(`md:` 기준으로 갈림).
  **전량완료는 칸만 채운다** — 확인하고 "전체 저장" 을 눌러야 저장된다.
  저장한 기록은 품목 행의 "수정" 으로 펼쳐 고치거나 지운다 (`/api/production/[id]` PATCH·DELETE).
  품목 완료 수량은 **생산 기록의 합으로 다시 맞춘다** (`lib/production/produced-quantity.ts`)
- **남은 품목 보기:** 생산 현황의 "남은 품목" (`/production?view=remaining`) — 진행 중 작업의뢰서에서
  다 만들지 않은 품목만 의뢰서별로 모아 납기 가까운 순으로 보인다. 한 장도 안 만든 품목은 `미착수`
- **일간 생산일지:** 기간을 골라 날짜별로 무엇을 몇 장 생산했는지 보고 엑셀로 받는다 (`/production/report`).
  같은 날·작업의뢰서·품목·주야·호기면 한 줄로 합친다 (`lib/production/daily-report.ts`).
  엑셀은 서식이 필요해 `exceljs` 로 만든다 — ① 생산일지(날짜 띠·소계·총계) ② 일별 합계(생산 없는 날도 0 으로)
- **재단실적 입력:** 원판 마스터 연동, 오도시/주야간 구분
- **대시보드:** 업무 흐름 바로 가기(STEP 1~3), 진행 중 작업의뢰서·남은 수량·오늘 생산·이번 달 면적,
  납기 임박(7일), 진행 중 작업의뢰서 진행률. 전부 작업의뢰서·생산 기준이다
- **마스터 관리:** 품명/거래처/현장/원판 4탭 CRUD
- **회원가입 · 승인:** `/signup` 에서 이름 · 전화 · 생년월일 · 부서 · 직책 · 아이디 · 비밀번호로 신청 →
  `승인 대기` → 사용자 관리의 "가입 신청" 에서 **권한을 고르며 승인** (거절하면 신청이 지워져 같은 아이디로 재신청 가능).
  아이디는 영문(이니셜도 됨), 비밀번호는 빈칸만 아니면 된다. Supabase Auth 의 제약(이메일 · 6바이트)은
  `lib/auth/account.ts` 가 감춘다 — 아이디는 `{id}@dgflow.local`, 짧은 비밀번호는 뒤에 고정 글자를 붙여 저장.
  **가입 · 로그인 · 비밀번호 초기화가 모두 이 함수를 거쳐야 서로 맞는다.**
  Supabase 공개 가입(`disable_signup`)은 껐다 — 계정은 서버(service role)만 만든다
- **사용자 관리:** 가입 승인 · 직접 추가 · 정보 수정 · 비밀번호 초기화 · 사용 중지(퇴사자는 지우지 말고 끈다).
  사용자 표는 브라우저에서 못 고친다(RLS) — `/api/users` 가 고친다

### 권한 체계
역할은 master / staff 둘. **기능 권한은 사용자마다 `dgflow_users.permissions` 에 저장한다** (2026-10-22).

| 역할 | 권한 |
|------|------|
| master (마스터) | 전체 기능 (permissions 무시) |
| staff (사원) | 부여받은 기능만. 권한이 없으면 메뉴가 비어 보인다 |

기능 권한 9개는 `lib/auth/role-guard.ts` 의 `PERMISSION_GROUPS` 한 곳에 정의한다 (사용자 관리 체크박스가 그대로 쓴다).

- 발주서: order:submit (올리기) / order:process (담당자로 받기 · ERP 변환 · 작업의뢰서 연결)
- 생산: erp:generate / work_order:create / production:view / production:input (→ view 를 함께 준다)
- 기타: dashboard:access / admin:master / admin:users

판정은 `hasPermission(user, key)` (여럿 중 하나면 `hasAnyPermission`) — 화면·API·메뉴 모두.
화면은 폴더의 `layout.tsx` 에서 `PermissionGate` 로 막는다 (`'use client'` 화면이 많아 화면 안에서 못 막는다).
**DB 도 같은 규칙으로 막는다** — `dgflow_has_permission(key)` 가 `hasPermission` 과 같은 판정이다. 하나를 바꾸면 둘 다 바꾼다.
사용자 관리 권한을 받은 사원은 자기에게 있는 권한 안에서만 주고 뺀다. 역할 변경 · 마스터 계정 수정은 마스터만.
묶음: 발주서 처리 / 발주서 등록 / 현장 (`PERMISSION_PRESETS`).

### 등록된 사용자 (마스터 1명)
- 마스터: 아이디 `admin` (김경영) / dgflow2026! — Auth 이메일은 예전 그대로 admin@dgflow.kr
- 사원은 `/signup` 으로 가입 신청하고 마스터가 승인한다. 마스터가 "직접 추가" 할 수도 있다.
- 로그인 화면에 있던 마스터 계정 자동 입력 버튼은 지웠다 (가입을 열면 누구나 마스터로 들어온다).

## 전체 흐름 (발주 건이 ERP 앞뒤를 잇는다)
```
발주서 접수 → 규격정리 → ERP 업로드 엑셀 →  (회사 ERP) → 작업의뢰서 →  생산현황
└──────── 앞단: ERP에 넣을 엑셀 만들기 ────────┘  └── 뒷단: 받아서 기록 ──┘
                                      ↑ 시스템 밖
└─────────── 발주 건 (/purchase-orders) 이 처음부터 끝까지 따라간다 ───────────┘
```
**ERP가 가운데를 끊는다.** 회사 ERP 와는 직접 연결할 수 없다(작업의뢰서에 자유 기재 칸도 없다).
그래서 발주 건이 ERP 업로드 엑셀의 포장을 기억해 두고, 돌아온 작업의뢰서를 규격 · 수량으로
그 포장에 다시 꽂으며 대조한다 — ERP 에 손으로 넣다 틀린 값이 유리를 자르기 전에 드러난다.
발주 건 없이 ERP 업로드 · 작업의뢰서 등록을 따로 쓰는 예전 길도 그대로 된다.

### 뒷단: 작업의뢰서 등록 (`/work-orders/receive`)
ERP 출력물 둘이 서로를 메운다 — **엑셀은 품목표**(비고가 온전), **PDF는 머리글**
(의뢰번호·업체명·현장명·날짜. 엑셀에 없는 값). 둘 다 올리면 손댈 것이 없다.
하나만 올려도, 아무것도 없어도 손으로 칠 수 있다.

- **품목은 엑셀이 이긴다.** PDF는 비고를 폭에 맞춰 자른다 (26-2090의 17행이 `…84A 발`).
  파일을 동시에 처리하면 둘 다 빈 표를 보고 각자 채워 PDF가 엑셀을 덮으므로
  **엑셀 먼저, PDF 나중**으로 순서를 고정했다 (`handleFiles`).
- **검산은 문서 자신에게 묻는다** — 품명 블록마다 찍힌 `소계`와 맨 밑 `합계`를 대조한다.
  그래서 소계·합계는 **인쇄된 그대로** 옮긴다. 읽은 품목에서 계산해 채우면 항상
  맞아떨어져 검산이 무의미해진다 (`lib/work-order/verify.ts`).
- **면적은 ERP 값을 그대로 받는다.** 손으로 칠 때만 계산하는데, 장당 2자리 반올림 후
  **최소 3재(0.28㎡)** 가 걸린다. 서해 26-2286의 실면적 0.17~0.23인 7개 행이 예외 없이
  0.28로 찍혔고, 2286.xlsx 13행·26-2090.pdf 17행이 이 규칙과 전부 일치했다.
- **의뢰번호는 채번하지 않는다** — ERP가 찍은 번호를 그대로 쓴다. 현장에서 종이와
  화면을 대조할 때 같은 번호여야 한다. 같은 번호를 두 번 올리면 막는다.
- ERP 작업의뢰서는 우리 쪽 주문이 없다 → `dgflow_work_orders.order_id` 는 **nullable**.
  거래처·현장 이름은 `lib/work-order/labels.ts` 의 `workOrderLabels` 한 곳에서 고른다
  (주문이 있으면 주문 것, 없으면 작업의뢰서 자신의 `customer_label`/`site_label`).

### 앞단: 발주서 → ERP 변환
실제 업무는 **발주서 → 규격정리 → ERP 업로드 엑셀 → (회사 ERP) → 작업의뢰서** 다.
작업의뢰서는 ERP가 뽑아 주므로 앞단의 최종 산출물은 **ERP에 넣을 엑셀**이다.
중간 단계인 규격정리도 실물을 뜯어 보니 구조가 기계적이어서 같이 만들어 준다
(좌=발주서 순서, 우=ERP 순서). 사람이 판단하는 것은 **품명 변환 하나뿐**이고,
그 품명은 ERP 업로드 엑셀에 열조차 없다.

**파서 설계 원칙 (반드시 지킬 것):** 발주서는 양식이 같아도 작성자마다 내용이 다르고,
학습되지 않은 양식이 계속 들어온다. **확실하게 읽어낸 값만 채우고, 판단이 필요한 값은
비운 뒤 `review` 로 사람에게 올린다.** 추측으로 채우지 않는다 —
틀린 값이 ERP를 거쳐 작업의뢰서까지 가면 유리를 잘못 자른다.

**완벽한 만능 파서는 목표가 아니다.** 대신 셋으로 받친다 —
① 검산(발주서 합계와 대조) ② 미리보기 편집 ③ 거래처별 양식 프로파일 저장.
파서가 80%만 맞혀도 사원이 나머지를 화면에서 고치면 일이 끝나게 만든다.

자동 판정이 불가능한 항목은 **품명 변환 하나뿐**이다
(`10CL T/P` → `24T 5MVT172+14단열(Ar.)+5CL` — 규칙이 없어 사람이 한다).

합친 호들의 실명은 **포괄하는 쪽**을 쓴다 (`lib/work-order/build.ts` 의 `pickRoom`).
합쳐진 줄이 그 호들의 창을 전부 담으니 라벨도 전부를 가리켜야 한다 —
실물 ERP 9시트가 예외 없이 그랬다. 포함 관계가 아닐 때만 사람에게 묻는다.
단 **문서마다 표기가 다르다**: ERP 엑셀은 `주방/식당,드레스룸`, 작업의뢰서 스캔본은 `주방/식당`.
그래서 `RoomPolicy` 로 나눠 둔다.

**동·라인 표기도 거래처마다 다르다** (2026-10-13 실사용 피드백). `3동 1호`(우미) · `102동 1,3호` + 다음 줄 `1F~9F` / `84A`(흥화) ·
`101동6~10층1,2,3,4호거실 大`(계룡)을 모두 읽는다 (`DONG_HO_RE`, `assembleLocations`).
비고 머리글이 두 칸 병합이면 글자가 든 칸을 고르고, 비고 오른쪽 **숫자 열은 비고 조각으로 붙이지 않는다**
(계룡 보조표 `기본` 열이 붙어 `거실 大1` 이 나갔다). 위치는 기본 `비고` 만, 사원이 고르면 **`위치 + 비고`** 로도 읽는다.

**거래처마다 같은 양식을 다르게 쓴다.** 우미는 `위 치` 열에, KCC는 `비 고` 열에 위치를 적는다
(KCC는 `위 치` 열이 23개 시트 전부 비어 있다). 그래서 열 **이름**이 아니라
실제로 채워진 **내용**으로 고른다.

세부 규칙은 `data/ERP-RULES.md`.

## 핵심 도메인 규칙
- 모든 DB 테이블명은 `dgflow_` 접두사 (23개 테이블)
- 품명 표기가 발주서와 ERP에서 다름 — dgflow_product_name_mappings 테이블로 변환 (11건)
- 면적 계산: `가로(mm) x 세로(mm) x 수량 / 1,000,000` (m2)
- 역할은 master/staff 두 가지뿐 — 세부 권한은 lib/auth/role-guard.ts 의 기능 키로 판정
- 의뢰번호 형식: `{YY}-{4자리}` (ERP 가 찍은 번호 그대로)

## 개발 시 주의사항 (해결된 이슈)

### Next.js 16 호환
- **middleware 사용 금지:** Next.js 16에서 Supabase SSR이 middleware에서 세션 파싱 실패. 인증 체크는 `app/(authenticated)/layout.tsx`에서 수행
- **로그인 방식:** `/api/auth/login` 에 아이디 · 비밀번호 → 서버가 아이디로 Auth 이메일을 찾아 로그인하고 세션 쿠키를 심는다
  → `window.location.href = '/'` (쓸 수 있는 첫 메뉴로 보낸다). 승인 대기 · 사용 중지면 세션을 지우고 이유를 돌려준다
- **알림(toast):** `app/layout.tsx` 에 `<Toaster />` 가 있어야 보인다. 빠져 있던 동안 화면의 toast 가 하나도 안 떴다
- **Windows 개발 서버:** dev 서버가 켜져 있으면 `app/` 아래 폴더 이름 바꾸기(git mv)가 "Permission denied" 로 실패한다
- **shadcn/ui Select:** @base-ui/react Select가 value를 그대로 표시하는 문제 → 네이티브 `<select>` 태그 사용

### Supabase RLS (2026-10-22 전면 교체 — 마이그레이션 016)
- 예전에는 "로그인만 하면 전부" 였고 작업의뢰서 · 생산 기록은 SELECT 가 `true` 라 **로그인 없이도 읽혔다**.
  회원가입을 열면서 바꿨다:
  - 읽기: `dgflow_is_active_user()` — 승인되고 사용 중인 사람만
  - 쓰기: 표마다 `dgflow_has_permission('그 일의 권한')` (마스터 표 → admin:master, 생산 기록 → production:input …)
  - `dgflow_users` 쓰기 · 발주 건 표 쓰기: 정책 없음 → 서버 API(service role)만
- **재귀 방지:** 판정 함수가 `SECURITY DEFINER` 라 dgflow_users 의 RLS 를 거치지 않는다
  (정책 안에서 dgflow_users 를 서브쿼리하면 무한 재귀가 났다)
- **getCurrentUser():** `createServerSupabaseClient`로 auth.getUser() → `createServiceRoleClient`로 dgflow_users 조회 (RLS 우회).
  승인 대기 · 사용 중지 계정은 세션이 남아 있어도 null 이다
- **작업의뢰서 API:** `createServiceRoleClient` 사용 필수 (anon key 세션으로는 품목 조회 실패)

### UI 공통 규칙 (2026-10-13 전면 정리)
- **색 토큰 등록:** `app/globals.css` 의 `@theme inline` 에 `--color-primary` 등을 등록해야 `bg-primary` ·
  `text-muted-foreground` · `border-input` 이 생긴다. 빠져 있던 동안 기본 버튼이 배경 없이 글자만 보였다.
  `gray-500` · `blue-600` 같은 날색 대신 토큰(`muted-foreground`, `brand-*`, `success`, `warning`, `destructive`)을 쓴다
- **화면 머리글:** `components/layout/PageHeader` (제목 · 설명 · 뒤로 · 행동 버튼)
- **여럿 중 하나 고르기:** 2~3개는 `components/ui/segmented`, 많으면 `components/ui/chip` 의 `chipClass`.
  고른 것은 남색으로 꽉 채운다 — 연한 하늘색이면 무엇이 골라졌는지 안 보인다
- **진행률:** `components/ui/progress` (100%면 초록). 작업의뢰서 상태는 `WorkOrderStatusBadge`
- **단계 화면:** `components/ui/step-title` 로 번호를 단다. 저장 버튼은 표가 길면 화면 아래 sticky 막대에 둔다
- 버튼 기본 높이 40px(`h-10`), 입력칸 40px. 버튼 안 아이콘에 `mr-2` 를 붙이지 않는다(버튼이 gap 으로 띄운다)

### 엑셀 파서
- 헤더 탐색 범위: 20행 (병합 헤더 대응)
- 품명 병합 셀: 빈 품명이면 이전 행의 품명 상속
- __EMPTY 컬럼: 하위 헤더 행의 값(가로/세로)으로 의미 파악
- Date 문자열 파싱: "Sun Aug 24 2025..." → ISO 날짜 변환
- Excel 시리얼 번호: 45894 → 날짜 변환

## 코딩 컨벤션

### TypeScript
- strict 모드, `as const` 객체 + 유니온 타입
- 주문 상태는 `types/order-status.ts`의 상수만 사용

### 파일 구조
- 페이지: `app/(authenticated)/{feature}/page.tsx`
- API: `app/api/{feature}/route.ts`
- 컴포넌트: `components/{feature}/{ComponentName}.tsx`
- 비즈니스 로직: `lib/{domain}/{module}.ts`
- 파서: `lib/parser/excel-order.ts`
- SQL: `supabase/migrations/{timestamp}_{description}.sql`

### Supabase 클라이언트 사용 규칙
- **브라우저 (Client Component):** `createClient()` from `lib/supabase/client.ts`
- **서버 (Server Component/API):** `createServerSupabaseClient()` — 쿠키 기반 세션
- **서버 관리자 권한:** `createServiceRoleClient()` — RLS 우회, 사용자 조회, 작업의뢰서 생성 등

### 테스트 (189건)
- `__tests__/permissions.test.ts` (6건): 사원별 권한 · 메뉴 · 첫 화면 · 함께 주는 권한
- `__tests__/account.test.ts` (9건): 아이디 · 짧은 비밀번호 감추기 · 전화번호 · 생년월일 · 가입 신청서
- `__tests__/purchase-order.test.ts` (10건): 포장 ↔ 작업의뢰서 대조(복층 배수 포함) · 단계 계산 · 멈춘 건 · 파일 조각
- `__tests__/area.test.ts` (4건): 면적 계산
- `__tests__/order-status.test.ts` (9건): 상태 전이 규칙
- `__tests__/grouping.test.ts` (3건): 규격 그룹핑
- `__tests__/excel-sheet-select.test.ts` (11건): 시트 선택·헤더 탐색·위치 추출
- `__tests__/work-order-build.test.ts` (14건): 작업의뢰서 스캔본 대조
- `__tests__/erp-upload.test.ts` (11건): 실물 ERP 엑셀 대조 + 미학습 양식 폴백
- `__tests__/erp-packaging-detect.test.ts` (16건): 포장 단위 감지 — **화면과 같은 경로**로 검증
- `__tests__/order-scan.test.ts` (14건): 발주서 구조 스캔 — 두 거래처 양식 + KCC 23시트 전수 검산
- `__tests__/erp-kcc.test.ts` (10건): KCC 실물 ERP 64행 대조 + 규격정리 재(才) 계산
- `__tests__/packaging-rule.test.ts` (13건): 수동 포장 구성 · 현장별 규칙 뽑아내기/적용
- `__tests__/form-profile.test.ts` (7건): 양식 프로파일 매칭 — **거래처 교차 적용 방지**
- `__tests__/work-order-scan.test.ts` (10건): 작업의뢰서 검산 — 실물 2장 전사 + 오독 탐지
- `__tests__/work-order-excel.test.ts` (10건): ERP 작업의뢰서 엑셀 읽기 (2286.xlsx 13행)
- `__tests__/order-scan-dongho.test.ts` (10건): 흥화·계룡 동·라인 표기 · 병합 비고 · 보조표 숫자 열
- `__tests__/daily-report.test.ts` (5건): 일간 생산일지 집계 · 정렬 · 날짜 도우미
- `__tests__/work-order-pdf.test.ts` (11건): ERP 작업의뢰서 PDF 읽기 (26-2090.pdf 머리글+17행)
  (fixture 가 repo 루트와 `엑셀 자료/` 에 있어야 실행됨. 없으면 skip —
  거래처 현장명이 들어 있어 `.gitignore` 로 `/*.xlsx` `/*.pdf` `/*.jpg` `/*.png` 를 뺀다)

## 배포 환경
- **GitHub:** https://github.com/choeyeongjun970-sudo/dg-flow (main 푸시 시 Vercel 자동 배포)
- **운영 URL:** https://dg-flow-snowy.vercel.app
- **Supabase ref:** vpfhvcjehgjeekckyyzv
- **Vercel 환경변수:** NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL
  (환경변수를 바꾸면 반드시 Redeploy — 기존 배포에는 소급 적용되지 않는다)

## Supabase DB 접근
- **SELECT:** `node scripts/db.mjs "SQL"` (exec_sql RPC, 빠름)
- **DDL/마이그레이션:** `node scripts/run-migrations.mjs [파일...]`
  (Management API 사용. 인자 없으면 supabase/migrations 전체를 순서대로 실행)
  이 PC에는 psql/docker가 없어 `supabase db query --linked` 는 쓸 수 없다.
- **환경변수:** `.env.local`에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN(마이그레이션 실행용)
- **주의:** 마이그레이션을 Management API로 적용했으므로
  `supabase_migrations.schema_migrations` 이력 테이블이 없다. 정식 CLI 경로로
  전환하려면 이력을 먼저 채워야 충돌하지 않는다.

## 커밋 컨벤션
```
feat: 기능 추가
fix: 버그 수정
docs: 문서 갱신
```

## 남은 작업
- ERP 시트명 규칙 확인 (현재는 포장 라벨 사용)
- 발주서 품명 → ERP 품목명 매핑을 `dgflow_product_name_mappings` 로 학습 누적
  (현재 규격정리는 발주서 품명을 그대로 내보내고 사원이 고친다)
- 양식 프로파일 · 포장 방식 관리 화면 (목록·수정·삭제. 현재는 ERP 업로드 화면에서 저장만 가능)
- 작업의뢰서 등록 화면 모바일 대응 (사무실 PC 를 전제로 뒀다. 생산실적 입력은 대응됨)
- 회사 ERP 직접 연동 (ERP 에 API · DB 읽기 · 정기 내보내기 중 하나라도 있으면 작업의뢰서를 자동으로 끌어올 수 있다)
- 발주 건 알림을 메일 · 카톡으로 (지금은 사이드바 배지 · 대시보드뿐)
- 읽기 권한 세분화 — 지금 RLS 읽기는 "활성 사용자면 전부" 다 (쓰기만 기능 권한으로 막는다)
- 가입 신청 남발 방지(요청 횟수 제한) — 사내용이라 두지 않았다
- Q4 ERP 마스터 데이터 시딩 (경영지원팀에 요청 완료, 수령 대기)
- 대시보드 필터링 (지역별/기간별)
- LLM 보조 파싱 (미매칭 품명 추천)

## 자율 개발 모드
- `data/TASK.md`의 태스크를 순서대로 완료
- 판단 필요 시 의사결정 기본값 적용 후 진행
- 에러 3회 시도 후 이슈 로그 기록, 다음 태스크 진행
- 컨텍스트 한계 시 TASK.md [중단 체크포인트] 기록

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
