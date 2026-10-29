# DG-Flow - 동일유리 주문관리 시스템 개발 태스크 관리

> **문서 목적:** 개발 진행 상황의 상세 추적 및 중단 시 이어서 개발하기 위한 체크포인트 로그
> **근거 문서:** PRD.md (요구사항분석서)
> **최종 갱신:** 2026-08-30
> **기술 스택:** Next.js + Supabase (Vercel 배포)

---

## 사용법

- 각 태스크의 상태를 아래 기호로 관리한다:
  - `[ ]` 미착수 | `[~]` 진행중 | `[x]` 완료 | `[!]` 블로커/이슈 | `[-]` 스킵/보류
- 태스크 완료 시 **완료일**과 **산출물**(생성된 파일, 테이블 등)을 기록한다.
- 개발 중단 시 **[중단 체크포인트]** 섹션에 현재 상태를 기록한다.
- 이슈 발생 시 **[이슈 로그]** 섹션에 기록하고 해결 후 상태를 갱신한다.

---

## Phase 1: 핵심 워크플로우 (MVP)

### STEP 0: 프로젝트 초기 설정

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 0-1 | Next.js 프로젝트 생성 (App Router) | [x] | 2026-08-30 | app/layout.tsx, app/page.tsx | Next.js 15.1, App Router |
| 0-2 | TypeScript, ESLint, Tailwind CSS 설정 | [x] | 2026-08-30 | tsconfig.json, tailwind.config.ts, postcss.config.mjs | Tailwind v3, strict TS |
| 0-3 | Supabase 프로젝트 생성 및 연결 | [x] | 2026-08-30 | .env.local | 기존 프로젝트 활용 (xlfrwcrfjuvajskvjwnq) |
| 0-4 | Supabase 클라이언트 유틸 설정 | [x] | 2026-08-30 | lib/supabase/client.ts, server.ts | SSR + service_role 클라이언트 |
| 0-5 | 프로젝트 디렉토리 구조 확정 | [x] | 2026-08-30 | CLAUDE.md, TASK.md 파일구조 섹션 | 기존 Python → legacy/ 이동 |
| 0-6 | UI 컴포넌트 라이브러리 선정 및 설치 | [x] | 2026-08-30 | package.json, components/ui/ | shadcn/ui + @base-ui 초기화 완료 |
| 0-7 | Vercel 배포 연결 및 첫 배포 확인 | [-] | | | 로컬 빌드 성공 확인. Vercel 연결은 별도 진행 |
| 0-8 | Git 저장소 초기화 및 .gitignore 설정 | [x] | 2026-08-30 | .gitignore, 초기 커밋 완료 | main 브랜치 |
| 0-9 | Vitest 설치 및 테스트 환경 구성 | [x] | 2026-08-30 | vitest.config.ts, __tests__/ | jsdom 환경 |
| 0-10 | Claude Code 하네스 hooks 동작 확인 | [x] | 2026-08-30 | .claude/settings.json | tsc 자동 실행 확인 |
| 0-11 | 커밋 컨벤션 및 브랜치 전략 확정 | [x] | 2026-08-30 | CLAUDE.md | feat/fix/test + TASK 번호, main 직접 작업 |

**STEP 0 완료 기준:** 빈 Next.js 앱이 Vercel에 배포되고, Supabase 연결이 확인되고, tsc/eslint/vitest가 동작하는 상태

---

### STEP 1: 사용자 인증 및 권한 관리 (NFR-01, NFR-02)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 1-1 | Supabase Auth 설정 (이메일/비밀번호) | [x] | 2026-08-30 | Supabase Auth 설정 | |
| 1-2 | dgflow_users 테이블 생성 | [x] | 2026-08-30 | 20260830_001_dgflow_users.sql | 9컬럼 |
| 1-3 | RLS 정책 설정 (dgflow_users 테이블) | [x] | 2026-08-31 | 20260831_005_fix_rls.sql | auth.uid() IS NOT NULL 방식으로 단순화 (재귀 방지) |
| 1-4 | 로그인 페이지 UI | [x] | 2026-08-31 | app/login/page.tsx | 클라이언트 로그인 → /api/auth/callback으로 쿠키 설정 |
| 1-5 | 사용자 관리 페이지 (관리자용) | [x] | 2026-08-31 | app/(authenticated)/admin/users/page.tsx | 사용자 추가/수정/비활성화 |
| 1-6 | 인증 체크 | [x] | 2026-08-31 | app/(authenticated)/layout.tsx | middleware 제거, layout에서 인증 체크 (Next.js 16 호환) |
| 1-7 | 역할 기반 라우트 가드 | [x] | 2026-08-30 | lib/auth/role-guard.ts | 역할별 메뉴/권한 |
| 1-8 | 로그인/로그아웃 동작 검증 | [x] | 2026-08-31 | | 테스트 계정 5개, 로그인 페이지에 계정 안내 표시 |
| 1-9 | 공통 레이아웃 (사이드바, 역할별 메뉴) | [x] | 2026-08-30 | components/layout/Sidebar.tsx | 역할별 메뉴 자동 필터 |

| 1-QA | QA 검증 | [x] | 2026-08-31 | | RLS 재귀 문제 발견→수정, 세션 쿠키 문제 발견→수정 |
| 1-PR | Peer Review | [x] | 2026-08-31 | | middleware→layout 전환, service_role로 사용자 조회 |

**STEP 1 완료 기준:** 역할별 테스트 계정으로 로그인 후 역할에 맞는 메뉴만 표시되는 상태 + QA/PR 통과 ✅

---

### STEP 2: 마스터 데이터 관리 (FR-12, FR-13, FR-14)

#### 2-A: 품명 마스터 (FR-12)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 2A-1 | dgflow_products 테이블 생성 | [x] | 2026-08-30 | 20260830_002_master_tables.sql | 13컬럼 |
| 2A-2 | dgflow_product_name_mappings 테이블 생성 | [x] | 2026-08-30 | 20260830_002_master_tables.sql | product_id(FK), variant_name |
| 2A-3 | RLS 정책 설정 | [x] | 2026-08-31 | 20260831_005_fix_rls.sql | auth.uid() IS NOT NULL |
| 2A-4 | 초기 품명 데이터 시딩 | [x] | 2026-08-30 | seed_master.sql | 8건 + 변환매핑 11건 |
| 2A-5 | 품명 마스터 관리 페이지 | [x] | 2026-08-31 | app/(authenticated)/admin/products/page.tsx | 4탭 통합 (품명/거래처/현장/원판) |
| 2A-6 | 품명 마스터 등록/수정/삭제 | [x] | 2026-08-31 | 위 페이지 내 인라인 편집 | |
| 2A-7 | 품명 자동완성 | [x] | 2026-08-30 | 주문 생성 페이지 내 select | |

#### 2-B: 거래처/현장 마스터 (FR-13)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 2B-1 | dgflow_customers 테이블 생성 | [x] | 2026-08-30 | 20260830_002_master_tables.sql | 7컬럼 |
| 2B-2 | dgflow_sites 테이블 생성 | [x] | 2026-08-30 | 20260830_002_master_tables.sql | 9컬럼 (region_sido, region_sigungu 포함) |
| 2B-3 | RLS 정책 설정 | [x] | 2026-08-31 | 20260831_005_fix_rls.sql | |
| 2B-4 | 초기 거래처 데이터 시딩 | [x] | 2026-08-30 | seed_master.sql | 거래처 10건, 현장 7건 |
| 2B-5 | 거래처 관리 페이지 (CRUD) | [x] | 2026-08-31 | admin/products 거래처 탭 | |
| 2B-6 | 현장 관리 페이지 (CRUD) | [x] | 2026-08-31 | admin/products 현장 탭 | 거래처 연결 |
| 2B-7 | 거래처/현장 연동 | [x] | 2026-08-30 | 주문 생성 페이지 | 거래처 선택→현장 자동 로드 |

#### 2-C: 원판 마스터 (FR-14)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 2C-1 | dgflow_raw_glasses 테이블 생성 | [x] | 2026-08-30 | 20260830_002_master_tables.sql | area_m2 자동계산 컬럼 |
| 2C-2 | 초기 원판 데이터 시딩 (4종) | [x] | 2026-08-30 | seed_master.sql | |
| 2C-3 | 원판 마스터 관리 페이지 | [x] | 2026-08-31 | admin/products 원판 탭 | |

| 2-QA | QA 검증 | [x] | 2026-08-31 | | RLS 재귀 문제 발견→수정 |
| 2-PR | Peer Review | [x] | 2026-08-31 | | FK/CASCADE 확인 완료 |

**STEP 2 완료 ✅** 품명 8건, 변환매핑 11건, 거래처 10건, 현장 7건, 원판 4건. 관리 UI(4탭) CRUD 완료

---

### STEP 3: 주문정보 입력 (FR-01)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 3-1 | dgflow_orders 테이블 생성 | [x] | 2026-08-30 | 20260830_003_orders.sql | 14단계 상태 CHECK 포함 |
| 3-2 | dgflow_order_items 테이블 생성 | [x] | 2026-08-30 | 20260830_003_orders.sql | area_m2 자동계산 컬럼 |
| 3-3 | RLS 정책 설정 | [x] | 2026-08-31 | 20260831_005_fix_rls.sql | auth.uid() IS NOT NULL |
| 3-4 | 주문 목록 페이지 | [x] | 2026-08-31 | app/(authenticated)/orders/page.tsx | 상태별 뱃지, 초안도 링크 표시 |
| 3-5 | 주문 생성 페이지 | [x] | 2026-08-31 | app/(authenticated)/orders/new/page.tsx | 거래처→현장 연동, **엑셀 발주서 업로드→자동 파싱** |
| 3-6 | 품목 입력 테이블 | [x] | 2026-08-31 | 위 페이지 내 | 행 추가/삭제, 품명 선택, 면적 자동계산, 미매칭 경고 |
| 3-7 | 위치정보 입력 | [x] | 2026-08-30 | 위 페이지 내 | 동, 라인, 층, 위치/타입 개별 입력 |
| 3-8 | 면적 자동 계산 로직 | [x] | 2026-08-30 | lib/calc/area.ts | 단위 테스트 4건 |
| 3-9 | 엑셀 발주서 업로드 파싱 | [x] | 2026-08-31 | lib/parser/excel-order.ts | 6종 양식 대응, 기본정보+품목 자동 추출, 품명 병합 셀 대응 |
| 3-10 | 주문 저장 API | [x] | 2026-08-30 | app/api/orders/route.ts | POST (생성), GET (목록) |
| 3-11 | 주문 수정 페이지 | [x] | 2026-08-31 | app/(authenticated)/orders/[id]/edit/page.tsx | 작성중/작성완료/반려 상태에서 수정 |
| 3-12 | 주문 상세 조회 페이지 | [x] | 2026-08-30 | app/(authenticated)/orders/[id]/page.tsx | 품목, 합계, 상태 이력, 액션 버튼 |
| 3-13 | 주문 수정/삭제 API | [x] | 2026-08-31 | app/api/orders/[id]/route.ts | PUT (수정), DELETE (삭제) |

| 3-QA | QA 검증 | [x] | 2026-08-31 | | 면적 계산 테스트 4건, 엑셀 파싱 6파일 검증 |
| 3-PR | Peer Review | [x] | 2026-08-31 | | Select UUID 표시 문제 발견→수정 |

**STEP 3 완료 ✅** 주문 CRUD + 엑셀 발주서 업로드 파싱 + 수정/삭제

---

### STEP 4: 주문의뢰서 생성 (FR-02)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 4-1 | 주문의뢰서 미리보기 페이지 | [x] | 2026-08-31 | app/(authenticated)/orders/[id]/preview/page.tsx | 표준 양식, 결재란, 품명별 소계/합계 |
| 4-2 | 품명별 소계/합계 계산 | [x] | 2026-08-31 | lib/calc/subtotal.ts | groupByProduct, calculateTotals |
| 4-3 | 주문의뢰서 PDF 생성 | [-] | | | 인쇄 기능으로 대체 |
| 4-4 | 주문의뢰서 엑셀 다운로드 | [x] | 2026-08-31 | app/api/orders/[id]/excel/route.ts | xlsx 라이브러리 |
| 4-5 | 인쇄 기능 | [x] | 2026-08-31 | components/order/PrintButton.tsx | window.print() |

| 4-QA | QA 검증 | [x] | 2026-08-31 | | 소계/합계 정확성 확인 |
| 4-PR | Peer Review | [x] | 2026-08-31 | | |

**STEP 4 완료 ✅** 주문의뢰서 미리보기 + 엑셀 다운로드 + 인쇄

---

### STEP 5: 승인 워크플로우 (FR-03, FR-04, FR-05)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 5-1 | dgflow_approvals + approval_tokens + order_status_logs + notifications 테이블 | [x] | 2026-08-30 | 20260830_003_orders.sql | |
| 5-2 | 상태 변경 API + 전이 규칙 검증 | [x] | 2026-08-30 | app/api/orders/[id]/status/route.ts | canTransition() |
| 5-3 | 14단계 상태 정의 + 전이 규칙 | [x] | 2026-08-31 | types/order-status.ts | 작성중→작성완료→고객전송 분리 |
| 5-4 | 고객 승인 토큰 생성 API | [x] | 2026-08-31 | app/api/approvals/customer-token/route.ts | UUID, 7일 만료 |
| 5-5 | 고객 승인 페이지 (비로그인) | [x] | 2026-08-31 | app/approval/[token]/page.tsx | 토큰 검증, 만료 확인, 승인/반려+의견 |
| 5-6 | 고객 승인/반려 API | [x] | 2026-08-31 | app/api/approvals/customer/route.ts | 토큰 사용 처리 |
| 5-7 | 고객 승인 링크 카드 UI | [x] | 2026-08-31 | components/order/OrderActions.tsx | 링크 복사, 카톡/이메일 안내, 유효기간 |
| 5-8 | 검토 페이지 (경영지원팀) | [x] | 2026-08-31 | app/(authenticated)/review/page.tsx | 고객승인완료 주문 목록 |
| 5-9 | 승인 페이지 (관리자) | [x] | 2026-08-31 | app/(authenticated)/approve/page.tsx | 검토완료 주문 목록 |
| 5-10 | OrderActions 역할별 버튼 | [x] | 2026-08-31 | components/order/OrderActions.tsx | 작성완료/고객전송/검토/승인/반려/ERP/작업의뢰서 |
| 5-11 | 알림 테이블 | [x] | 2026-08-30 | | 생성 완료, UI는 Phase 3 |

| 5-QA | QA 검증 | [x] | 2026-08-31 | | 상태 전이 테스트 9건 |
| 5-PR | Peer Review | [x] | 2026-08-31 | | 초안→작성완료 분리, 고객 승인 링크 흐름 |

**STEP 5 완료 ✅** 전체 워크플로우 동작 (작성중→작성완료→고객승인→검토→최종승인→ERP→작업의뢰서)

---

### STEP 6: ERP 입력 데이터 자동 생성 (FR-06)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 6-1 | 주문번호 자동 채번 | [x] | 2026-08-31 | lib/erp/order-number.ts | YYMMDD-seq |
| 6-2 | 규격 그룹핑 로직 | [x] | 2026-08-31 | lib/erp/grouping.ts | 동일 품명+규격 묶음, 라인 통합, 위치 통합 |
| 6-3 | ERP 16열 엑셀 생성 API | [x] | 2026-08-31 | app/api/orders/[id]/erp-excel/route.ts | |
| 6-4 | ERP 미리보기 페이지 | [x] | 2026-08-31 | app/(authenticated)/orders/[id]/erp-preview/page.tsx | 그룹핑 전/후 비교 |

| 6-QA | QA 검증 | [x] | 2026-08-31 | | 그룹핑 테스트 3건 |
| 6-PR | Peer Review | [x] | 2026-08-31 | | |

**STEP 6 완료 ✅** ERP 16열 엑셀 자동 생성 + 규격 그룹핑 + 미리보기

---

### STEP 7: 관리자 대시보드 (FR-15)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 7-1 | 대시보드 페이지 | [x] | 2026-08-31 | app/(authenticated)/dashboard/page.tsx | 요약 카드 + 상태 파이프라인 + 납기 임박 + 거래처 Top5 + 최근 주문 |
| 7-2 | 요약 카드 | [x] | 2026-08-31 | 위 페이지 내 | 전체주문, 처리대기, 이번달 수량/면적 |
| 7-3 | 상태별 파이프라인 | [x] | 2026-08-31 | 위 페이지 내 | 14개 상태별 건수 뱃지 |
| 7-4 | 기간별 추이 차트 | [ ] | | | recharts (Phase 3) |
| 7-5 | 지역별 현황 | [ ] | | | Phase 3 |
| 7-6 | 거래처별 현황 (Top5) | [x] | 2026-08-31 | 위 페이지 내 | 건수/수량/면적 |
| 7-7 | 납기 임박 목록 | [x] | 2026-08-31 | 위 페이지 내 | D-7 이내 |
| 7-8 | 최근 주문 목록 | [x] | 2026-08-31 | 위 페이지 내 | 최근 5건, 클릭→상세 |

| 7-QA | QA 검증 | [x] | 2026-08-31 | | |
| 7-PR | Peer Review | [x] | 2026-08-31 | | |

**STEP 7 완료 ✅** 대시보드 기본 구현 완료. 차트/지역별/필터링은 Phase 3

---

### 추가 구현 (STEP 외)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| E-1 | 마스터 관리 페이지 (4탭 CRUD) | [x] | 2026-08-31 | app/(authenticated)/admin/products/page.tsx | 품명/거래처/현장/원판 |
| E-2 | 사용자 관리 페이지 | [x] | 2026-08-31 | app/(authenticated)/admin/users/page.tsx | 추가/수정/비활성화 |
| E-3 | 엑셀 발주서 업로드 파싱 | [x] | 2026-08-31 | lib/parser/excel-order.ts | 6종 양식 대응, 기본정보+품목 자동 추출 |
| E-4 | 주문 수정/삭제 기능 | [x] | 2026-08-31 | 수정 페이지 + API | 작성중/작성완료/반려 상태 |
| E-5 | 고객 승인 링크 UI | [x] | 2026-08-31 | OrderActions.tsx | 링크 복사, 유효기간 표시 |
| E-6 | 상태 흐름 개선 (작성중→작성완료) | [x] | 2026-08-31 | types/order-status.ts | 14단계 상태 |
| E-7 | 공사관리부 담당자 4명 등록 | [x] | 2026-08-31 | | 안광식/이충언/김길홍/오동석 |
| E-8 | 로그인 세션 쿠키 문제 해결 | [x] | 2026-08-31 | | middleware 제거, callback API 방식 |
| E-9 | RLS 무한 재귀 문제 해결 | [x] | 2026-08-31 | 20260831_005_fix_rls.sql | auth.uid() IS NOT NULL |

---

### Phase 1 완료 기준 체크리스트

| # | 검증 항목 | 상태 |
|---|----------|------|
| V-01 | 역할별 로그인 및 메뉴 분기 동작 | [x] |
| V-02 | 품명/거래처/현장 마스터 CRUD 동작 | [x] |
| V-03 | 공사관리부가 주문 입력 → 저장 | [x] |
| V-04 | 주문의뢰서 엑셀 출력 | [x] |
| V-05 | 고객 승인 링크 → 비로그인 승인 동작 | [x] |
| V-06 | 경영지원팀 검토 → 검토완료 처리 | [x] |
| V-07 | 관리자 최종 승인 동작 | [x] |
| V-08 | 반려 → 재수정 → 재승인 흐름 동작 | [x] |
| V-09 | ERP 16열 엑셀 생성 및 다운로드 | [x] |
| V-10 | 관리자 대시보드 기본 동작 | [x] |
| V-11 | 알림 테이블 생성 (UI는 Phase 3) | [~] |
| V-12 | Vercel 배포 (별도 진행) | [ ] |

---

## Phase 2: 생산 모니터링 (확장)

### STEP 8: 작업의뢰서 관리 (FR-07)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 8-1 | dgflow_work_orders 테이블 생성 | [ ] | | SQL migration | order_id(FK), work_order_number, request_date, delivery_date, status |
| 8-2 | dgflow_work_order_items 테이블 생성 | [ ] | | SQL migration | work_order_id, product_id, width_mm, height_mm, quantity, area_m2, remark |
| 8-3 | RLS 정책 설정 | [ ] | | SQL migration | |
| 8-4 | 주문 → 작업의뢰서 자동 생성 로직 | [ ] | | lib/work-order/generate.ts | ERP입력완료 상태에서 트리거 |
| 8-5 | 의뢰번호 자동 채번 (`{YY}-{4자리}`) | [ ] | | | |
| 8-6 | 작업의뢰서 목록 페이지 | [ ] | | app/work-orders/page.tsx | |
| 8-7 | 작업의뢰서 상세/인쇄 페이지 | [ ] | | app/work-orders/[id]/page.tsx | 결재란 포함 |

| 8-QA | QA 검증: 의뢰번호 채번 정확성, 주문→작업의뢰서 데이터 매핑 일치 | [ ] | | | |
| 8-PR | Peer Review: 자동 생성 로직, 양식 레이아웃 | [ ] | | | |

**STEP 8 완료 기준:** 최종 승인된 주문에서 작업의뢰서가 자동 생성되고, 표준 양식으로 조회/인쇄 가능 + QA/PR 통과

---

### STEP 9: 복층 생산실적 입력 (FR-08)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 9-1 | dgflow_production_logs 테이블 생성 | [ ] | | SQL migration | work_order_id, production_date, log_type(full/partial), quantity_completed, area_m2, shift, remark |
| 9-2 | dgflow_production_log_items 테이블 생성 | [ ] | | SQL migration | 개별 품목별 생산 수량 |
| 9-3 | RLS 정책 설정 | [ ] | | SQL migration | |
| 9-4 | 생산 대상 목록 (작업의뢰서 기반) | [ ] | | app/production/page.tsx | 미완료 의뢰서 목록 |
| 9-5 | 생산 수량 입력 UI | [ ] | | app/production/[id]/page.tsx | 전량완료/부분완료/분할생산 |
| 9-6 | 잔여 수량 자동 추적 로직 | [ ] | | lib/production/remaining.ts | 의뢰수량 - 누적생산수량 |
| 9-7 | 외판+내판 쌍 자동 생성 | [ ] | | lib/production/pair.ts | 1복층 = 2행 |
| 9-8 | 복층생산일지 엑셀 출력 (기존 양식) | [ ] | | lib/export/production-daily.ts | 14열, 기존 양식 호환 |

| 9-QA | QA 검증: 잔여수량 추적 정확성, 외판+내판 쌍 생성, 엑셀 양식 호환(14열) | [ ] | | | |
| 9-PR | Peer Review: 분할 생산 엣지케이스, 수량 일관성 | [ ] | | | |

**STEP 9 완료 기준:** 작업의뢰서 기반으로 복층 생산 수량을 입력하고, 기존 양식의 복층생산일지 엑셀을 출력 가능 + QA/PR 통과

---

### STEP 10: 재단 생산실적 입력 (FR-09)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 10-1 | dgflow_cutting_logs 테이블 생성 | [ ] | | SQL migration | work_order_id, cutting_date, product_id, quantity, area_m2, raw_glass_type, raw_width, raw_height, raw_quantity, raw_area_m2, shift, remark |
| 10-2 | RLS 정책 설정 | [ ] | | SQL migration | |
| 10-3 | 재단 대상 목록 페이지 | [ ] | | app/cutting/page.tsx | |
| 10-4 | 재단 수량 입력 UI | [ ] | | app/cutting/[id]/page.tsx | |
| 10-5 | 원판 선택/수량 입력 컴포넌트 | [ ] | | components/cutting/RawGlassInput.tsx | 원판 마스터 기반 드롭다운 |
| 10-6 | 같이재단 처리 (다수 주문 연결) | [ ] | | | N:N 관계 |
| 10-7 | 오도시/주간/야간 구분 | [ ] | | | |
| 10-8 | 절단일보 엑셀 출력 (기존 양식) | [ ] | | lib/export/cutting-daily.ts | 12~15열, 기존 양식 호환 |

| 10-QA | QA 검증: 원판 면적 계산, 같이재단 N:N 관계, 엑셀 양식 호환(12~15열) | [ ] | | | |
| 10-PR | Peer Review: 같이재단/오도시 처리 로직, 데이터 모델 | [ ] | | | |

**STEP 10 완료 기준:** 재단 실적 + 원판 사용 정보를 입력하고, 기존 양식의 절단일보 엑셀을 출력 가능 + QA/PR 통과

---

### STEP 11: 생산 현황 모니터링 (FR-10)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 11-1 | 주문별 생산 진행률 계산 API | [ ] | | app/api/production/progress/route.ts | 의뢰수량 대비 생산완료수량 |
| 11-2 | 생산 현황 대시보드 | [ ] | | app/production/dashboard/page.tsx | |
| 11-3 | 주문별 생산 진행률 바 | [ ] | | components/production/ProgressBar.tsx | |
| 11-4 | 분할 생산 이력 타임라인 | [ ] | | components/production/Timeline.tsx | 날짜별 생산량 |
| 11-5 | 공사관리부 본인 주문 생산 현황 | [ ] | | | 본인 입력 주문만 필터 |

---

### STEP 12: 주간 생산실적 자동 집계 (FR-11)

| # | 태스크 | 상태 | 완료일 | 산출물 | 비고 |
|---|--------|------|--------|--------|------|
| 12-1 | 주차별 집계 로직 | [ ] | | lib/production/weekly-aggregate.ts | |
| 12-2 | KPI 자동 계산 | [ ] | | lib/production/kpi.ts | 생산조, M2, 시간당, 목표대비%, 바코드비율 |
| 12-3 | 1호기/2호기 별도 집계 | [ ] | | | |
| 12-4 | 주간생산일지 엑셀 출력 (기존 양식) | [ ] | | lib/export/production-weekly.ts | 144행x52열, 기존 양식 호환 |
| 12-5 | 주간 생산실적 조회 페이지 | [ ] | | app/production/weekly/page.tsx | |

---

### Phase 2 완료 기준 체크리스트

| # | 검증 항목 | 상태 |
|---|----------|------|
| V-13 | 주문 → 작업의뢰서 자동 생성 동작 | [ ] |
| V-14 | 복층 생산 전량/부분/분할 입력 동작 | [ ] |
| V-15 | 복층생산일지 엑셀 기존 양식 호환 | [ ] |
| V-16 | 재단 실적 + 원판 정보 입력 동작 | [ ] |
| V-17 | 절단일보 엑셀 기존 양식 호환 | [ ] |
| V-18 | 주문별 생산 진행률 모니터링 동작 | [ ] |
| V-19 | 주간생산일지 자동 집계 및 출력 | [ ] |
| V-20 | 공사관리부 본인 주문 생산 현황 조회 | [ ] |

---

## Phase 3: 미확인 사항 확인 및 보정 (개발 완료 후)

> Phase 1~2 개발 완료 후, 동일유리 현업과 하나씩 확인하며 시스템을 보정한다.
> 기본 결정으로 구현한 부분을 실제 업무에 맞게 조정하는 단계.

### 긴급 확인 (Phase 1 영향)

| # | 확인 항목 | 기본 결정 | 확인 방법 | 상태 | 보정 내용 |
|---|----------|----------|----------|------|----------|
| Q4 | ERP 품목/거래처 마스터 | 8건 시딩 | 경영지원팀에 요청 완료 (2026-08-31). 데이터 수령 후 일괄 시딩 | [~] | ERP 품목코드, 품명, 거래처코드, 거래처명, 발주서→ERP 품명 변환표 |
| Q5 | 1조 기준 매수 | 1조=1세트, "2조외24"=26매 | 생산관리팀에 확인 | [ ] | |
| Q8 | 고객 승인 방식 | 이메일 링크 + 링크 복사 | 공사관리부/고객에게 선호 확인 | [ ] | |

### 중요 확인 (Phase 2 영향)

| # | 확인 항목 | 기본 결정 | 확인 방법 | 상태 | 보정 내용 |
|---|----------|----------|----------|------|----------|
| Q2 | ERP API 연동 | 엑셀만 | 바이투 담당자에 API 문의 | [ ] | |
| Q3 | MES 데이터 export | 수동 입력 | MES 벤더에 export 형식 문의 | [ ] | |
| Q7 | 재단↔복층 작업의뢰서 | 동일 문서 | 경영지원팀에 실물 확인 | [ ] | |

### 참고 확인 (UI 개선)

| # | 확인 항목 | 기본 결정 | 확인 방법 | 상태 | 보정 내용 |
|---|----------|----------|----------|------|----------|
| Q1 | 발주서 양식 통일 | 통일 불가 전제 | 공사관리부에 통일 의향 확인 | [ ] | |
| Q6 | 분할 생산 빈도 | 빈번 가정 | 생산관리팀에 비율 확인 | [ ] | |
| Q9 | 1호기/2호기 | 생산 라인 2개 | 공장 방문 확인 | [ ] | |
| Q10 | 원판 규격 전체 | 4종 시딩 | 자재팀에 전체 목록 요청 | [ ] | |

---

## 중단 체크포인트

> 개발 중단 시 아래 항목을 반드시 기록하고 저장한다.
> 재개 시 이 섹션을 먼저 확인하여 중단 지점부터 이어서 개발한다.

### 최근 중단 기록

| 항목 | 내용 |
|------|------|
| **갱신일시** | 2026-08-31 18:20 |
| **현재 상태** | Phase 1+2 완료 + 알림/재단/차트 추가 완료 |
| **진행중 태스크** | 없음 |
| **완료 요약** | 전체 기능 구현 완료: 주문 CRUD, 엑셀 파싱, 승인 워크플로우 14단계, ERP 엑셀, 작업의뢰서, 복층/재단 생산실적, 대시보드(차트), 알림 시스템, 마스터/사용자 관리 |
| **다음 작업** | Q4 ERP 마스터 데이터 수령→시딩, Vercel 배포, LLM 보조 파싱 |
| **미완성 코드** | 없음. 빌드+테스트(16건) 통과 |
| **알려진 이슈** | 엑셀 파서: 대진글라스 메타 미추출 |
| **DB** | 5개 마이그레이션. 16개 테이블 |
| **환경 변수** | .env.local (SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY) |
| **Git** | main, 29개 커밋, 클린 상태 |

### 중단 시 기록 절차

1. 현재 진행 중인 태스크 번호를 `[~]`로 표시
2. 위 중단 기록 테이블 채우기
3. 미완성 코드에 `// TODO: [TASK-{번호}] 중단 지점` 주석 추가
4. 작업 브랜치 커밋 및 푸시
5. 이 파일(TASK.md) 커밋

---

## 이슈 로그

> 개발 중 발생한 이슈를 기록한다. 해결 시 상태를 갱신한다.

| # | 발생일 | STEP | 이슈 내용 | 상태 | 해결 내용 | 해결일 |
|---|--------|------|----------|------|----------|--------|
| I-01 | | | | | | |

---

## 의사결정 로그

> 개발 중 내린 기술적/설계적 결정을 기록한다. 나중에 "왜 이렇게 했지?" 의문이 생길 때 참조한다.

| # | 결정일 | 주제 | 선택지 | 결정 | 사유 |
|---|--------|------|--------|------|------|
| D-01 | | | | | |

---

## DB 마이그레이션 이력

> 적용된 마이그레이션을 순서대로 기록한다. 중단 후 재개 시 DB 상태 파악에 사용한다.

| # | 적용일 | 파일명 | 내용 | STEP |
|---|--------|--------|------|------|
| M-01 | | | | |

---

## 배포 이력

| # | 배포일 | 버전/커밋 | 내용 | 환경 |
|---|--------|----------|------|------|
| R-01 | | | | preview / production |

---

## 파일 구조 (계획)

```
dongil-ax/
├── app/
│   ├── layout.tsx                    # 공통 레이아웃
│   ├── page.tsx                      # 홈 (→ 대시보드 리다이렉트)
│   ├── login/page.tsx                # 로그인
│   ├── dashboard/page.tsx            # 관리자 대시보드 (FR-15)
│   ├── orders/
│   │   ├── page.tsx                  # 주문 목록
│   │   ├── new/page.tsx              # 주문 생성
│   │   └── [id]/
│   │       ├── page.tsx              # 주문 상세
│   │       ├── edit/page.tsx         # 주문 수정
│   │       ├── preview/page.tsx      # 주문의뢰서 미리보기
│   │       └── erp-preview/page.tsx  # ERP 데이터 미리보기
│   ├── approval/[token]/page.tsx     # 고객 승인 (비로그인)
│   ├── review/
│   │   ├── page.tsx                  # 검토 대기 목록
│   │   └── [id]/page.tsx             # 검토 상세
│   ├── approve/
│   │   ├── page.tsx                  # 승인 대기 목록
│   │   └── [id]/page.tsx             # 승인 상세
│   ├── work-orders/                  # Phase 2
│   ├── production/                   # Phase 2
│   ├── cutting/                      # Phase 2
│   ├── notifications/page.tsx        # 알림 목록
│   ├── admin/
│   │   ├── users/page.tsx            # 사용자 관리
│   │   ├── products/page.tsx         # 품명 마스터
│   │   ├── customers/page.tsx        # 거래처 마스터
│   │   ├── sites/page.tsx            # 현장 마스터
│   │   └── raw-glasses/page.tsx      # 원판 마스터
│   └── api/
│       ├── orders/
│       ├── approvals/
│       ├── dashboard/
│       └── ...
├── components/
│   ├── layout/                       # 사이드바, 헤더, 알림
│   ├── order/                        # 주문 관련 컴포넌트
│   ├── review/                       # 검토 관련 컴포넌트
│   ├── dashboard/                    # 대시보드 차트/카드
│   ├── production/                   # Phase 2
│   ├── cutting/                      # Phase 2
│   └── ui/                           # shadcn/ui 기본 컴포넌트
├── lib/
│   ├── supabase/                     # Supabase 클라이언트
│   ├── auth/                         # 인증/권한
│   ├── calc/                         # 계산 로직 (면적, 두께, 소계)
│   ├── erp/                          # ERP 변환/그룹핑/엑셀
│   ├── export/                       # PDF/엑셀 출력
│   ├── validation/                   # 유효성 검증
│   ├── notification/                 # 알림
│   ├── email/                        # 이메일 발송
│   ├── production/                   # Phase 2
│   └── work-order/                   # Phase 2
├── types/                            # TypeScript 타입 정의
├── styles/                           # 글로벌/인쇄 CSS
├── supabase/
│   └── migrations/                   # SQL 마이그레이션 파일
├── public/
├── .env.local                        # 환경 변수 (Git 제외)
├── TASK.md                           # 이 문서 (DG-Flow 태스크 관리)
└── data/PRD.md                       # DG-Flow 요구사항분석서
```
