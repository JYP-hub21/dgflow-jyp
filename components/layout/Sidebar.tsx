'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { USER_ROLES } from '@/types/user';
import {
  activeMenuHref, defaultPoView, getMenuFor, type MenuItem, type PermissionSubject,
} from '@/lib/auth/role-guard';
import { DEPARTMENTS, deptOf, type DeptKey } from '@/lib/departments';
import { DEPT_STYLE } from './dept-style';
import { MENU_ICONS } from './menu-icons';
import { LayoutDashboard, LogOut, Menu, X } from 'lucide-react';
import Logo from './Logo';

interface SidebarProps {
  userName: string;
  user: PermissionSubject;
  /** 사원 정보의 부서 칸 — 세 부서 중 하나로 읽히면 그 구역에 '내 부서' 를 붙인다 */
  department?: string | null;
  /** 메뉴 옆 숫자 (href → 건수) */
  badges?: Record<string, number>;
}

/** 이름 끝 두 글자를 아바타 이니셜로 (한국어 이름 기준) */
function initials(name: string) {
  return name.length > 2 ? name.slice(-2) : name;
}

export default function Sidebar({ userName, user, department, badges = {} }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const menuItems = getMenuFor(user);
  const [open, setOpen] = useState(false);
  const myDept = deptOf(department);

  // 화면을 옮겨 가면 서랍은 닫는다
  useEffect(() => setOpen(false), [pathname, searchParams]);

  const activeHref = activeMenuHref(menuItems, pathname, searchParams.get('view'), defaultPoView(user));
  const common = menuItems.filter(i => i.group === 'common');
  const admin = menuItems.filter(i => i.group === 'admin');
  const deptGroups = DEPARTMENTS
    .map(dept => ({ dept, items: menuItems.filter(i => i.group === dept.key) }))
    .filter(g => g.items.length > 0);

  const link = (item: MenuItem, tone: DeptKey | 'neutral') => (
    <NavLink key={item.href} item={item} tone={tone}
      active={item.href === activeHref} badge={badges[item.href]} onNavigate={() => setOpen(false)} />
  );

  /*
    폰에서는 서랍으로 연다. `w-64` 를 그대로 두면 390px 화면의 256px 를 먹어
    본문에 134px 밖에 안 남는다 — 생산실적 입력칸이 22px 로 찌그러졌다.
  */
  return (
    <>
      {/* 폰 — 위에 붙는 띠. 햄버거 · 로고 */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b bg-background px-4 md:hidden">
        <button type="button" onClick={() => setOpen(true)}
          aria-label="메뉴 열기" className="-ml-2 rounded-lg p-2 hover:bg-accent">
          <Menu className="h-5 w-5" />
        </button>
        {/* 띠 높이가 56px 라 워드마크만 — `withTitle` 을 붙이면 넘친다 */}
        <Link href="/dashboard" className="min-w-0">
          <Logo size="sm" priority />
        </Link>
      </header>

      {/* 서랍이 열렸을 때 뒤를 덮는 막 */}
      {open && (
        <div onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden />
      )}

      <aside
        className={cn(
          'flex h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar',
          // 폰: 화면 밖에 두고 열릴 때만 밀어 넣는다
          'fixed inset-y-0 left-0 z-50 transition-transform md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* 로고 */}
        <div className="flex items-start justify-between px-5 pb-3 pt-4">
          <Link href="/dashboard" onClick={() => setOpen(false)}
            className="transition-opacity hover:opacity-80">
            <Logo size="sm" withTitle priority />
          </Link>
          <button type="button" onClick={() => setOpen(false)}
            aria-label="메뉴 닫기" className="rounded-lg p-1.5 hover:bg-accent md:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mx-5 h-px bg-sidebar-border" />

        {/*
          메뉴 — 공통 / 부서 셋 / 관리.
          2026-10-30 현장 피드백: "로그인하고 뭘 해야 하는지 모르겠다" → 부서마다 색 구역을 두고
          발주서가 거쳐 가는 순서대로 번호를 붙였다. 자기 부서 구역만 보면 할 일이 다 있다.
        */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {common.length > 0 && <div className="space-y-1">{common.map(i => link(i, 'neutral'))}</div>}

          {deptGroups.length > 0 && (
            <div className={cn(common.length > 0 && 'mt-4')}>
              <p className="mb-2 px-2 text-[11px] font-bold tracking-wider text-muted-foreground/80">
                부서별 업무 <span className="font-medium">· 번호는 진행 순서</span>
              </p>
              <div className="space-y-2">
                {deptGroups.map(({ dept, items }) => {
                  const s = DEPT_STYLE[dept.key];
                  return (
                    <div key={dept.key}>
                      <section aria-label={dept.name} className={cn('rounded-xl p-1.5', s.panel)}>
                        <div className="flex items-center gap-2 px-1.5 pb-1 pt-1">
                          <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', s.solid)}>
                            {dept.order}
                          </span>
                          <span className={cn('text-[13px] font-bold tracking-tight', s.text)}>{dept.name}</span>
                          {myDept === dept.key && (
                            <span className={cn('ml-auto rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold shadow-xs', s.text)}>
                              내 부서
                            </span>
                          )}
                        </div>
                        <div className="space-y-0.5">{items.map(i => link(i, dept.key))}</div>
                      </section>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {admin.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 px-2 text-[11px] font-bold tracking-wider text-muted-foreground/80">관리</p>
              <div className="space-y-1">{admin.map(i => link(i, 'neutral'))}</div>
            </div>
          )}
        </nav>

        {/* 사용자 */}
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
              myDept ? DEPT_STYLE[myDept].solid : 'bg-brand-100 text-brand-800'
            )}>
              {initials(userName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{userName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[department, USER_ROLES[user.role]].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <button
            onClick={async () => {
              await fetch('/api/auth/signout', { method: 'POST' });
              window.location.href = '/login';
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            로그아웃
          </button>
        </div>
      </aside>
    </>
  );
}

/** 메뉴 한 줄 — 부서 구역 안에서는 그 부서 색, 공통 · 관리는 남색 */
function NavLink({ item, tone, active, badge, onNavigate }: {
  item: MenuItem;
  tone: DeptKey | 'neutral';
  active: boolean;
  badge?: number;
  onNavigate: () => void;
}) {
  const Icon = MENU_ICONS[item.icon] || LayoutDashboard;
  const dept = tone === 'neutral' ? null : DEPT_STYLE[tone];
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-3 text-[14px] font-semibold transition-all',
        dept ? 'h-9' : 'h-10',
        active
          ? cn('shadow-sm', dept ? dept.solid : 'bg-brand-800 text-white shadow-brand-900/25')
          : dept
            ? 'text-foreground/80 hover:bg-white/85 hover:text-foreground'
            : 'text-foreground/75 hover:bg-brand-50 hover:text-brand-900'
      )}
    >
      <Icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-colors',
          active ? 'text-white' : dept ? dept.icon : 'text-muted-foreground group-hover:text-brand-800'
        )}
      />
      {item.label}
      {badge != null && badge > 0 && (
        <span className={cn(
          'ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold',
          active ? cn('bg-white', dept ? dept.text : 'text-brand-800') : 'bg-warning text-white'
        )}>{badge}</span>
      )}
    </Link>
  );
}
