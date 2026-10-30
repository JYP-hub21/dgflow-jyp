/**
 * 회사 부서 — 발주서 한 건은 공사개발부 → 업무지원부 → 생산관리부 순서로 흐른다.
 *
 * 2026-10-30 현장 피드백: "로그인하고 무엇을 해야 하는지, 일이 어떻게 진행되는지 모르겠다."
 * 그래서 사이드바 · 대시보드 · 화면 머리글이 이 목록 하나로 부서 이름 · 순서 · 색을 맞춘다.
 * 색은 app/globals.css 의 `--dept-*` 토큰이다.
 */
export type DeptKey = 'construction' | 'support' | 'production';

export interface Department {
  key: DeptKey;
  name: string;
  /** 발주서가 거쳐 가는 순서 (1부터) */
  order: number;
  /** 이 부서가 시스템에서 하는 일 — 대시보드 업무 흐름 칸에 쓴다 */
  summary: string;
}

export const DEPARTMENTS: Department[] = [
  {
    key: 'construction', name: '공사개발부', order: 1,
    summary: '현장에서 받은 발주서를 올리고, 처리할 담당자를 지목합니다.',
  },
  {
    key: 'support', name: '업무지원부', order: 2,
    summary: '받은 발주서로 ERP 업로드 엑셀을 만들고, ERP가 뽑아 준 작업의뢰서를 등록합니다.',
  },
  {
    key: 'production', name: '생산관리부', order: 3,
    summary: '작업의뢰서를 보고 생산한 수량을 기록하고, 생산일지를 냅니다.',
  },
];

export const DEPT_BY_KEY = Object.fromEntries(DEPARTMENTS.map(d => [d.key, d])) as Record<DeptKey, Department>;

/**
 * 사원 정보의 부서 칸(자유 입력)을 세 부서 중 하나로 읽는다. 못 읽으면 null.
 * '공사개발부' 대신 '공사부' · '업무지원팀' · '생산팀' 처럼 적어도 알아보게 핵심 낱말로 본다.
 */
export function deptOf(department: string | null | undefined): DeptKey | null {
  const s = (department ?? '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes('공사')) return 'construction';
  if (s.includes('업무지원') || s.startsWith('업무')) return 'support';
  if (s.includes('생산')) return 'production';
  return null;
}
