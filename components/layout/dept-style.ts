import type { DeptKey } from '@/lib/departments';

/**
 * 부서 색 클래스 — 토큰은 app/globals.css 의 `--dept-*`.
 * Tailwind 가 소스에서 클래스를 찾아 만들므로 이름을 조립하지 않고 통째로 적는다.
 */
export interface DeptStyle {
  /** 옅은 구역 바탕 + 테두리 */
  panel: string;
  /** 진한 색 글자 */
  text: string;
  /** 진한 색 바탕 + 흰 글자 — 고른 메뉴, 순서 번호 */
  solid: string;
  /** 진한 색 아이콘 */
  icon: string;
  /** 이름표 — 옅은 바탕 + 진한 글자 */
  chip: string;
  /** 굵은 띠 · 점 */
  bar: string;
  /** 강조 테두리 — 대시보드의 내 부서 칸 */
  ring: string;
  /** 옅은 바탕 (테두리 없이) — 마우스를 올린 줄 */
  softHover: string;
}

export const DEPT_STYLE: Record<DeptKey, DeptStyle> = {
  construction: {
    panel: 'bg-dept-construction-soft ring-1 ring-inset ring-dept-construction-line/70',
    text: 'text-dept-construction',
    solid: 'bg-dept-construction text-white',
    icon: 'text-dept-construction',
    chip: 'bg-dept-construction-soft text-dept-construction ring-1 ring-inset ring-dept-construction-line',
    bar: 'bg-dept-construction',
    ring: 'ring-2 ring-dept-construction',
    softHover: 'hover:bg-dept-construction-soft',
  },
  support: {
    panel: 'bg-dept-support-soft ring-1 ring-inset ring-dept-support-line/70',
    text: 'text-dept-support',
    solid: 'bg-dept-support text-white',
    icon: 'text-dept-support',
    chip: 'bg-dept-support-soft text-dept-support ring-1 ring-inset ring-dept-support-line',
    bar: 'bg-dept-support',
    ring: 'ring-2 ring-dept-support',
    softHover: 'hover:bg-dept-support-soft',
  },
  production: {
    panel: 'bg-dept-production-soft ring-1 ring-inset ring-dept-production-line/70',
    text: 'text-dept-production',
    solid: 'bg-dept-production text-white',
    icon: 'text-dept-production',
    chip: 'bg-dept-production-soft text-dept-production ring-1 ring-inset ring-dept-production-line',
    bar: 'bg-dept-production',
    ring: 'ring-2 ring-dept-production',
    softHover: 'hover:bg-dept-production-soft',
  },
};
