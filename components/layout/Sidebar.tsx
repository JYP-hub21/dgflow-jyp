'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types/user';
import { USER_ROLES } from '@/types/user';
import { getMenuForRole } from '@/lib/auth/role-guard';
import {
  LayoutDashboard, ClipboardList, FileCheck, CheckCircle,
  Factory, Database, Users, LogOut,
} from 'lucide-react';
import NotificationBell from './NotificationBell';

const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard, ClipboardList, FileCheck, CheckCircle,
  Factory, Database, Users,
};

interface SidebarProps {
  userName: string;
  userRole: UserRole;
}

export default function Sidebar({ userName, userRole }: SidebarProps) {
  const pathname = usePathname();
  const menuItems = getMenuForRole(userRole);

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-white">
      <div className="border-b px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">DG-Flow</h1>
          <p className="text-xs text-gray-500">동일유리 주문관리</p>
        </div>
        <NotificationBell />
      </div>

      <nav className="flex-1 space-y-1 px-2 py-4">
        {menuItems.map((item) => {
          const Icon = ICON_MAP[item.icon] || LayoutDashboard;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t px-4 py-3">
        <p className="text-sm font-medium text-gray-900">{userName}</p>
        <p className="text-xs text-gray-500">{USER_ROLES[userRole]}</p>
        <button
          onClick={async () => {
            await fetch('/api/auth/signout', { method: 'POST' });
            window.location.href = '/login';
          }}
          className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-900 mt-2"
        >
          <LogOut className="h-3 w-3" />
          로그아웃
        </button>
      </div>
    </aside>
  );
}
