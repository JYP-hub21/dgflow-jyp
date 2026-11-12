import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldOff } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/get-user';
import { canViewAny, deptNameFor, getMenuFor, hasAnyPermission, PERMISSION_LABELS, type PermissionSubject } from '@/lib/auth/role-guard';

/**
 * 화면 단위 권한 문.
 *
 * 브라우저에서 바로 DB 를 읽는 화면('use client')이 많아 화면 안에서는 막을 수 없다.
 * 그래서 그 화면 폴더의 layout.tsx 에서 감싼다. 데이터 자체는 RLS 가 같은 권한으로 막는다.
 */
export default async function PermissionGate({ permission, view = false, children }: {
  /** 여럿이면 그중 하나만 있어도 들어간다 */
  permission: string | string[];
  /** 보기만 하는 화면 — 부서와 상관없이 권한 목록만 본다 (2026-11-12: 직원은 모든 탭을 본다) */
  view?: boolean;
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const ok = view ? canViewAny(user, permission) : hasAnyPermission(user, permission);
  if (!ok) return <NoPermission user={user} permission={permission} />;
  return <>{children}</>;
}

export function NoPermission({ user, permission }: { user: PermissionSubject; permission: string | string[] }) {
  const menu = getMenuFor(user);
  const keys = typeof permission === 'string' ? [permission] : permission;
  const needed = keys.map(k => PERMISSION_LABELS[k] ?? k).join(' 또는 ');
  // 볼 수는 있는데 다른 부서의 일인 화면 — "○○ 계정에서 진행합니다" 로 안내한다
  const dept = keys.map(deptNameFor).find(Boolean);
  if (dept && canViewAny(user, keys)) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <ShieldOff className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-4 font-semibold text-foreground">{dept} 업무 화면입니다</p>
        <p className="mt-1 break-keep text-sm text-muted-foreground">
          <b className="text-foreground">{needed}</b> 업무는 {dept} 계정에서 진행합니다.
          <br />진행 상황은 다른 메뉴에서 확인할 수 있습니다.
        </p>
        {menu.length > 0 && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {menu.map(m => (
              <Link key={m.href} href={m.href}
                className="rounded-lg border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent">
                {m.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-card p-8 text-center">
      <ShieldOff className="mx-auto h-10 w-10 text-muted-foreground" />
      <p className="mt-4 font-semibold text-foreground">이 화면에 접근할 권한이 없습니다</p>
      <p className="mt-1 text-sm text-muted-foreground">
        필요한 권한: <b className="text-foreground">{needed}</b>
        <br />관리자에게 권한을 요청하세요.
      </p>
      {menu.length > 0 && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {menu.map(m => (
            <Link key={m.href} href={m.href}
              className="rounded-lg border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent">
              {m.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
