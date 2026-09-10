# DG-Flow - 동일유리 주문관리 시스템

## 프로젝트 개요
- **프로젝트명:** DG-Flow (Dongil Glass Flow)
- **목적:** 동일유리(주) 주문→승인→ERP→생산 전체 워크플로우 디지털화
- **기술 스택:** Next.js 16 (App Router, Turbopack) + Supabase (PostgreSQL/Auth) + Vercel
- **UI:** shadcn/ui (@base-ui) + Tailwind CSS v4
- **근거 문서:** `data/PRD.md` (요구사항), `data/TASK.md` (태스크 관리)
- **규모:** 20 페이지, 15 API, 16 DB 테이블, 79 소스 파일, 39 커밋

## 구현 완료 현황

### 핵심 워크플로우 (14단계 상태)
```
작성중(draft) → 작성완료(completed) → 고객승인대기 → 고객승인완료
→ 검토중 → 검토완료 → 최종승인 → 작업의뢰서 자동 생성
→ 생산중 → 생산완료
(+ 반려-수정중, 반려-재검토, 승인취소→검토완료 복귀)
```

### 구현된 기능
- **주문 CRUD:** 생성/수정/삭제(본인 주문만)/목록/상세
- **엑셀 발주서 업로드:** 6종 양식 자동 파싱 (기본정보+품목), 품명 병합 셀 대응
- **주문의뢰서:** 표준 양식 미리보기, 결재란(검토자/승인자 자동 표시), 엑셀/인쇄
- **고객 승인:** 토큰 기반 비로그인 승인/반려, 승인 링크 카드(복사 기능)
- **검토/승인:** 경영지원팀 검토, 관리자 최종승인(작업의뢰서 자동 생성), 승인 취소
- **ERP 엑셀:** 16열 양식, 규격 그룹핑, 주문번호 자동 채번
- **작업의뢰서 상세:** 전체 진행률 바, 품목별 현황, 복층/재단 이력 통합
- **생산실적 일괄 입력:** 전체 저장, 전량완료, 일별 생산 이력, 주/야간·호기
- **재단실적 입력:** 원판 마스터 연동, 오도시/주야간 구분
- **대시보드:** 요약 카드, 상태 파이프라인, 추이 차트(recharts), 납기 임박, 거래처 Top5
- **알림 시스템:** 상태 변경 시 역할별 자동 알림, 벨 아이콘(30초 폴링), 전체 목록
- **마스터 관리:** 품명/거래처/현장/원판 4탭 CRUD
- **사용자 관리:** 추가/수정/비활성화

### 권한 체계
| 역할 | 주문 | 검토 | 승인 | 생산 | 관리 |
|------|------|------|------|------|------|
| construction_mgr (공사관리부) | 생성/본인수정/조회 | - | - | 조회 | - |
| biz_support (경영지원팀) | 수정/조회 | 검토 | - | 조회 | 마스터 CRUD |
| admin (관리자) | 조회 | - | 승인/반려/취소 | 조회 | - |
| production_mgr (생산관리팀) | 조회 | - | - | 입력/조회 | - |
| system_admin (시스템관리자) | 전체 | 전체 | 전체 | 전체 | 전체 |

### 등록된 사용자 (9명)
- 공사관리부: ahn@, lee@, kim@, oh@, construction@dgflow.kr (안광식/이충언/김길홍/오동석/박공사)
- 경영지원팀: support@dgflow.kr (이지원)
- 관리자: admin@dgflow.kr (김경영)
- 생산관리팀: production@dgflow.kr (최생산)
- 시스템관리자: sysadmin@dgflow.kr (정시스)
- 비밀번호: 전원 dgflow2026!

## 핵심 도메인 규칙
- 모든 DB 테이블명은 `dgflow_` 접두사 (16개 테이블)
- 품명 표기가 발주서와 ERP에서 다름 — dgflow_product_name_mappings 테이블로 변환 (11건)
- 면적 계산: `가로(mm) x 세로(mm) x 수량 / 1,000,000` (m2)
- 주문 상태 14단계: types/order-status.ts에 정의 (작성중→작성완료→고객승인대기→...→생산완료)
- 작업의뢰서 생성 2경로: (A) 최종승인 시 주문에서 자동 생성 (B) 바이투 엑셀 직접 업로드 (주문 없이)
- 작업의뢰서 order_id는 NULLABLE — 바이투 업로드 시 null, 대신 customer_name/site_name 자체 저장
- 주문번호 형식: `{YYMMDD}-{일련번호}`, 의뢰번호 형식: `{YY}-{4자리}`
- 공사관리부는 본인 주문만 수정/삭제 가능 (타인 주문은 조회만)

## 개발 시 주의사항 (해결된 이슈)

### Next.js 16 호환
- **middleware 사용 금지:** Next.js 16에서 Supabase SSR이 middleware에서 세션 파싱 실패. 인증 체크는 `app/(authenticated)/layout.tsx`에서 수행
- **로그인 방식:** 클라이언트 Supabase 로그인 → `/api/auth/callback`으로 서버 쿠키 설정 → `window.location.href` 이동
- **shadcn/ui Select:** @base-ui/react Select가 value를 그대로 표시하는 문제 → 네이티브 `<select>` 태그 사용

### Supabase RLS
- **재귀 방지:** 모든 테이블의 RLS 정책을 `auth.uid() IS NOT NULL`로 단순화 (dgflow_users 서브쿼리 시 무한 재귀)
- **getCurrentUser():** `createServerSupabaseClient`로 auth.getUser() → `createServiceRoleClient`로 dgflow_users 조회 (RLS 우회)
- **작업의뢰서 API:** `createServiceRoleClient` 사용 필수 (anon key 세션으로는 품목 조회 실패)

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
- 파서: `lib/parser/excel-order.ts` (발주서), `lib/parser/work-order-excel.ts` (바이투 작업의뢰서)
- SQL: `supabase/migrations/{timestamp}_{description}.sql`

### Supabase 클라이언트 사용 규칙
- **브라우저 (Client Component):** `createClient()` from `lib/supabase/client.ts`
- **서버 (Server Component/API):** `createServerSupabaseClient()` — 쿠키 기반 세션
- **서버 관리자 권한:** `createServiceRoleClient()` — RLS 우회, 사용자 조회, 작업의뢰서 생성 등

### 테스트 (16건)
- `__tests__/area.test.ts` (4건): 면적 계산
- `__tests__/order-status.test.ts` (9건): 상태 전이 규칙
- `__tests__/grouping.test.ts` (3건): 규격 그룹핑

## Supabase DB 접근
- **SELECT:** `node scripts/db.mjs "SQL"` (exec_sql RPC, 빠름)
- **DDL/DML:** `echo "SQL" | npx supabase db query --linked`
- **프로젝트 ref:** xlfrwcrfjuvajskvjwnq (supabase link 완료)
- **환경변수:** `.env.local`에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

## 커밋 컨벤션
```
feat: 기능 추가
fix: 버그 수정
docs: 문서 갱신
```

## 남은 작업
- **[진행중] STEP 8B: 바이투 작업의뢰서 엑셀 직접 업로드 (FR-16)**
  - DB: order_id nullable + customer_name/site_name/source 컬럼 추가
  - 파서: lib/parser/work-order-excel.ts (바이투 27열 → 의뢰번호별 그룹핑)
  - API: POST /api/work-orders/upload
  - UI: 업로드 모달 + 목록/상세 null 안전 처리
  - 참고: data/바이투 업로드양식.xlsx (772행, 15개 의뢰번호)
- Q4 ERP 마스터 데이터 시딩 (경영지원팀에 요청 완료, 수령 대기)
- Vercel 프로덕션 배포
- 주간생산일지 집계/엑셀 출력
- 대시보드 필터링 (지역별/기간별)
- LLM 보조 파싱 (미매칭 품명 추천)
- 알림 이메일 발송 (Resend)

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
