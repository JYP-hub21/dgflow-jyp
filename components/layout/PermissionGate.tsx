import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldOff } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/get-user';
import { getMenuFor, hasAnyPermission, PERMISSION_LABELS, type PermissionSubject } from '@/lib/auth/role-guard';

/**
 * 화면 단위 권한 문.
 *
 * 브라우저에서 바로 DB 를 읽는 화면('use client')이 많아 화면 안에서는 막을 수 없다.
 * 그래서 그 화면 폴더의 layout.tsx 에서 감싼다. 데이터 자체는 RLS 가 같은 권한으로 막는다.
 */
export default async function PermissionGate({ permission, children }: {
  /** 여럿이면 그중 하나만 있어도 들어간다 */
  permission: string | string[];
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!hasAnyPermission(user, permission)) return <NoPermission user={user} permission={permission} />;
  return <>{children}</>;
}

export function NoPermission({ user, permission }: { user: PermissionSubject; permission: string | string[] }) {
  const menu = getMenuFor(user);
  const needed = (typeof permission === 'string' ? [permission] : permission).map(k => PERMISSION_LABELS[k] ?? k).join(' 또는 ');
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-card p-8 text-center">
      <ShieldOff className="mx-auto h-10 w-10 text-muted-foreground" />
      <p className="mt-4 font-semibold text-foreground">이 화면을 쓸 권한이 없습니다</p>
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
