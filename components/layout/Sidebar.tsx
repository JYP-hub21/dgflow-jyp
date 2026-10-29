'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { USER_ROLES } from '@/types/user';
import { getMenuFor, type PermissionSubject } from '@/lib/auth/role-guard';
import {
  LayoutDashboard, FileCheck, Factory, Database, Users, LogOut,
  FileSpreadsheet, ScanLine, ClipboardList, Menu, X, Inbox,
} from 'lucide-react';
import Logo from './Logo';

const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard, FileCheck, Factory, Database, Users, FileSpreadsheet, ScanLine, ClipboardList, Inbox,
};

interface SidebarProps {
  userName: string;
  user: PermissionSubject;
  /** 메뉴 옆 숫자 (href → 건수) */
  badges?: Record<string, number>;
}

/** 이름 끝 두 글자를 아바타 이니셜로 (한국어 이름 기준) */
function initials(name: string) {
  return name.length > 2 ? name.slice(-2) : name;
}

export default function Sidebar({ userName, user, badges = {} }: SidebarProps) {
  const pathname = usePathname();
  const menuItems = getMenuFor(user);
  const [open, setOpen] = useState(false);

  // 화면을 옮겨 가면 서랍은 닫는다
  useEffect(() => setOpen(false), [pathname]);

  // 메뉴 경로가 서로 겹친다 (`/work-orders` 와 `/work-orders/scan`).
  // 접두사로만 보면 둘 다 켜지므로 가장 깊이 맞는 하나만 고른다.
  const activeHref = menuItems
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

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
        <div className="flex items-start justify-between px-5 pb-4 pt-5">
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

        {/* 메뉴 — 업무 / 관리 두 구역 */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {([['work', '업무'], ['admin', '관리']] as const).map(([section, title]) => {
            const items = menuItems.filter((i) => i.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section} className="mb-5 last:mb-0">
                <p className="mb-1.5 px-3 text-[11px] font-bold tracking-wider text-muted-foreground/80">{title}</p>
                <div className="space-y-1">
                  {items.map((item) => {
                    const Icon = ICON_MAP[item.icon] || LayoutDashboard;
                    const isActive = item.href === activeHref;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'group relative flex h-11 items-center gap-3 rounded-lg px-3 text-[14px] font-semibold transition-all',
                          isActive
                            ? 'bg-brand-800 text-white shadow-sm shadow-brand-900/25'
                            : 'text-foreground/75 hover:bg-brand-50 hover:text-brand-900'
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-[18px] w-[18px] shrink-0 transition-colors',
                            isActive ? 'text-white' : 'text-muted-foreground group-hover:text-brand-800'
                          )}
                        />
                        {item.label}
                        {badges[item.href] > 0 && (
                          <span className={cn(
                            'ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold',
                            isActive ? 'bg-white text-brand-800' : 'bg-warning text-white'
                          )}>{badges[item.href]}</span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* 사용자 */}
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
              {initials(userName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{userName}</p>
              <p className="truncate text-xs text-muted-foreground">{USER_ROLES[user.role]}</p>
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
