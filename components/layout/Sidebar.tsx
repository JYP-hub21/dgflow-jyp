'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { affiliationLabel } from '@/types/user';
import {
  activeMenuHref, defaultPoView, getMenuFor, type MenuItem, type PermissionSubject,
} from '@/lib/auth/role-guard';
import { DEPARTMENTS, deptOf, type DeptKey } from '@/lib/departments';
import { DEPT_STYLE } from './dept-style';
import { MENU_ICONS } from './menu-icons';
import { KeyRound, LayoutDashboard, LogOut, Menu, X } from 'lucide-react';
import { InstallApp } from './AppShell';
import Logo from './Logo';
import AccountDialog from './AccountDialog';
import { INITIAL_PASSWORD_FLAG } from '@/lib/auth/account';
import PrismMark from '@/components/prism/PrismMark';
import { openPrism } from '@/components/prism/PrismAssistant';

interface SidebarProps {
  userName: string;
  user: PermissionSubject;
  /** 사원 정보의 부서 칸 — 세 부서 중 하나로 읽히면 그 구역에 '내 부서' 를 붙인다 */
  department?: string | null;
  /** 메뉴 옆 숫자 (href → 건수) */
  badges?: Record<string, number>;
  /** 로그인 아이디 — 아이디/비밀번호 변경 창에 미리 채운다 */
  loginId: string;
  /** 관리자 빠른 로그인 계정이면 아이디 변경을 잠근다 */
  loginIdLocked: boolean;
  /** 직급 (조직도) */
  position?: string | null;
}

/** 이름 끝 두 글자를 아바타 이니셜로 (한국어 이름 기준) */
function initials(name: string) {
  return name.length > 2 ? name.slice(-2) : name;
}

/** 화면을 띄워 둔 동안 메뉴 숫자를 다시 세는 간격 */
const BADGE_REFRESH_MS = 60_000;

/**
 * 메뉴 숫자 — 처음엔 서버가 센 값, 그다음엔 1분마다(화면이 보일 때만) 다시 센다.
 * 2026-11-13 회의(생산관리부): 화면을 켜 둔 채 일하다가도 새 작업의뢰서가 오면 "신규 1" 을 보고 들어가면 된다.
 * 다른 창을 보고 있어도 알 수 있게 브라우저 탭 제목 앞에도 (숫자)를 붙인다.
 */
function useLiveBadges(initial: Record<string, number>, pathname: string) {
  const initialKey = JSON.stringify(initial);
  const [badges, setBadges] = useState(initial);
  // 서버가 다시 그리면(수신 확인 뒤 새로고침 등) 그 값을 따른다
  useEffect(() => setBadges(JSON.parse(initialKey)), [initialKey]);

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/notifications', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json() as { badges?: Record<string, number> };
        if (!stopped && body.badges) setBadges(body.badges);
      } catch { /* 숫자는 알림일 뿐 — 못 세면 다음에 다시 */ }
    };
    const timer = window.setInterval(refresh, BADGE_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const total = Object.values(badges).reduce((s, n) => s + n, 0);
  // 탭 제목 앞 (숫자) — 화면을 옮기면 제목이 새로 붙으므로 경로가 바뀔 때도 다시 단다
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\)\s*/, '');
      const next = total > 0 ? `(${total}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    const t = window.setTimeout(apply, 300);
    return () => window.clearTimeout(t);
  }, [total, pathname]);

  // 홈 화면에 설치한 앱이면 아이콘에도 숫자를 붙인다 (지원하는 폰 · PC 만)
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      if (total > 0) void nav.setAppBadge?.(total).catch(() => {});
      else void nav.clearAppBadge?.().catch(() => {});
    } catch { /* 숫자는 알림일 뿐 */ }
  }, [total]);

  return { badges, total };
}

/**
 * 폰 아래쪽 탭 — 홈 + 내 부서에서 가장 자주 여는 화면 + 전체 메뉴 (2026-11-16 사용자 "폰 화면 편리하게").
 * 폰에서는 메뉴가 접혀 있어 화면을 옮길 때마다 왼쪽 위 메뉴를 열어야 했다.
 * 부서를 모르는 계정(관리자 등)은 발주서 → 작업의뢰서 → 생산 순서로 둔다.
 */
const BOTTOM_TABS: Record<DeptKey | 'default', string[]> = {
  construction: ['/purchase-orders/new', '/purchase-orders?view=mine'],
  support: ['/purchase-orders?view=todo', '/work-orders', '/production'],
  production: ['/work-orders', '/production', '/deliveries'],
  default: ['/purchase-orders?view=todo', '/work-orders', '/production'],
};

export default function Sidebar({ userName, user, department, position, badges: initialBadges = {}, loginId, loginIdLocked }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const menuItems = getMenuFor(user);
  const { badges, total: badgeTotal } = useLiveBadges(initialBadges, pathname);
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  /** 처음 비밀번호(0000)로 막 들어온 경우 — 변경 창을 한 번 띄워 권한다 (닫으면 다시 묻지 않는다) */
  const [firstLogin, setFirstLogin] = useState(false);
  const myDept = deptOf(department);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(INITIAL_PASSWORD_FLAG) !== '1') return;
      sessionStorage.removeItem(INITIAL_PASSWORD_FLAG);
    } catch { return; }
    setFirstLogin(true);
    setAccountOpen(true);
  }, []);

  // 화면을 옮겨 가면 서랍은 닫는다
  useEffect(() => setOpen(false), [pathname, searchParams]);

  const activeHref = activeMenuHref(menuItems, pathname, searchParams.get('view'), defaultPoView(user));
  const common = menuItems.filter(i => i.group === 'common');
  const admin = menuItems.filter(i => i.group === 'admin');
  const deptGroups = DEPARTMENTS
    .map(dept => ({ dept, items: menuItems.filter(i => i.group === dept.key) }))
    .filter(g => g.items.length > 0);

  const tabs = BOTTOM_TABS[myDept ?? 'default']
    .map(href => menuItems.find(i => i.href === href))
    .filter((i): i is MenuItem => !!i);
  /** 지금 보고 있는 탭을 다시 누르면 새로 고친다 — 앱으로 깔면 브라우저의 새로고침 버튼이 없다 */
  const onTab = (e: React.MouseEvent, active: boolean) => {
    if (!active) return;
    e.preventDefault();
    router.refresh();
    document.getElementById('app-main')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b bg-background px-4 md:hidden print:hidden">
        <button type="button" onClick={() => setOpen(true)}
          aria-label={badgeTotal > 0 ? `메뉴 열기 — 새로 온 일 ${badgeTotal}건` : '메뉴 열기'}
          className="relative -ml-2 rounded-lg p-2 hover:bg-accent">
          <Menu className="h-5 w-5" />
          {/* 폰은 메뉴가 접혀 있어 숫자가 안 보인다 — 메뉴 버튼에 붙여 둔다 */}
          {badgeTotal > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-warning px-1 text-[10.5px] font-bold text-white">
              {badgeTotal}
            </span>
          )}
        </button>
        {/* 띠 높이가 56px 라 워드마크만 — `withTitle` 을 붙이면 넘친다 */}
        <Link href="/dashboard" className="min-w-0">
          <Logo size="sm" priority />
        </Link>
        <button type="button" onClick={() => openPrism()} aria-label="DG 프리즘에게 묻기"
          className="ml-auto -mr-1 rounded-lg p-1 hover:bg-accent">
          <PrismMark small />
        </button>
      </header>

      {/* 서랍이 열렸을 때 뒤를 덮는 막 */}
      {open && (
        <div onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden />
      )}

      <aside
        className={cn(
          'flex h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar print:hidden',
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
          {/* DG 프리즘 — 어느 화면에서나 무엇이든 묻는다 (2026-11-15 사용자 "어떤 질문이든 다 답은 할 수 있어야지") */}
          <button type="button" onClick={() => { setOpen(false); openPrism(); }}
            className="mb-3 flex h-11 w-full items-center gap-2.5 rounded-xl bg-card px-2.5 text-left text-[14px] font-semibold text-brand-900 shadow-xs ring-1 ring-brand-600/20 transition-colors hover:bg-brand-50">
            <PrismMark small />
            DG 프리즘에게 묻기
          </button>
          {common.length > 0 &&<div className="space-y-1">{common.map(i => link(i, 'neutral'))}</div>}

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
        <div className="border-t border-sidebar-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <InstallApp />
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
                {affiliationLabel({ department, position, role: user.role })}
              </p>
            </div>
          </div>
          <button
            onClick={() => setAccountOpen(true)}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <KeyRound className="h-3.5 w-3.5" />
            아이디/비밀번호 변경
          </button>
          <button
            onClick={async () => {
              await fetch('/api/auth/signout', { method: 'POST' });
              window.location.href = '/login';
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            로그아웃
          </button>
        </div>
      </aside>

      {/* 폰 — 아래쪽 탭 */}
      <nav aria-label="바로 가기"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
        <div className="mx-auto flex h-14 max-w-lg items-stretch">
          <BottomTab href="/dashboard" label="홈" icon={LayoutDashboard} active={pathname === '/dashboard'}
            onClick={e => onTab(e, pathname === '/dashboard')} />
          {tabs.map(item => (
            <BottomTab key={item.href} href={item.href} label={item.label} icon={MENU_ICONS[item.icon] || LayoutDashboard}
              active={item.href === activeHref} badge={badges[item.href]} onClick={e => onTab(e, item.href === activeHref)} />
          ))}
          <button type="button" onClick={() => setOpen(true)} aria-label="전체 메뉴 열기"
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-muted-foreground active:bg-accent">
            <Menu className="h-[22px] w-[22px]" />
            <span className="text-[11px] font-medium">전체</span>
          </button>
        </div>
      </nav>

      {accountOpen && (
        <AccountDialog loginId={loginId} loginIdLocked={loginIdLocked}
          notice={firstLogin ? '처음 비밀번호(0000)로 로그인하셨습니다. 본인만 아는 아이디와 비밀번호로 변경하시기 바랍니다. 지금 변경하지 않으려면 [나중에]를 누르세요. 언제든 왼쪽 메뉴 아래 [아이디/비밀번호 변경]에서 변경할 수 있습니다.' : undefined}
          onClose={() => { setAccountOpen(false); setFirstLogin(false); }} />
      )}
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
      {/* "신규 1" — 2026-11-13 회의(생산관리부) "1을 보고 들어가면 되니까" */}
      {badge != null && badge > 0 && (
        <span className={cn(
          'tabular ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold',
          active ? cn('bg-white', dept ? dept.text : 'text-brand-800') : 'bg-warning text-white'
        )}>신규 {badge}</span>
      )}
    </Link>
  );
}

/** 아래쪽 탭 한 칸 — 아이콘 위 · 이름 아래, 새로 온 일은 아이콘 옆 숫자 */
function BottomTab({ href, label, icon: Icon, active, badge, onClick }: {
  href: string; label: string; icon: React.ElementType; active: boolean; badge?: number; onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <Link href={href} onClick={onClick} aria-current={active ? 'page' : undefined}
      className={cn('relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 active:bg-accent',
        active ? 'text-brand-800' : 'text-muted-foreground')}>
      <span className="relative">
        <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} />
        {badge != null && badge > 0 && (
          <span className="tabular absolute -right-2.5 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-warning px-1 text-[10.5px] font-bold text-white">
            {badge}
          </span>
        )}
      </span>
      <span className={cn('max-w-full truncate px-0.5 text-[11px]', active ? 'font-bold' : 'font-medium')}>{label}</span>
    </Link>
  );
}
