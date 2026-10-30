'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { menuForPage } from '@/lib/auth/role-guard';
import { DEPT_BY_KEY } from '@/lib/departments';
import { DEPT_STYLE } from './dept-style';

/**
 * 화면 제목 위 부서 이름표 — 이 화면이 어느 부서의 일인지, 사이드바 구역과 같은 색 · 번호로.
 * 부서가 정해지지 않는 화면(대시보드 · 관리 · 발주 건 상세)에서는 아무것도 그리지 않는다.
 */
export default function DeptChip({ className }: { className?: string }) {
  const pathname = usePathname();
  const view = useSearchParams().get('view');
  const group = menuForPage(pathname, view)?.group;
  if (!group || group === 'common' || group === 'admin') return null;
  const dept = DEPT_BY_KEY[group];
  const s = DEPT_STYLE[group];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1 pr-2.5 text-[12px] font-bold', s.chip, className)}>
      <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none', s.solid)}>{dept.order}</span>
      {dept.name}
    </span>
  );
}
