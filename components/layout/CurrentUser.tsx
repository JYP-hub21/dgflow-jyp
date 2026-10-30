'use client';

import { createContext, useContext } from 'react';
import type { PermissionSubject } from '@/lib/auth/role-guard';

/**
 * 로그인한 사람 — 서버 레이아웃(app/(authenticated)/layout.tsx)이 한 번 읽어 내려 준다.
 * 'use client' 화면이 권한에 따라 갈 곳을 고를 때 쓴다 (예: 작업의뢰서 등록 뒤 이동).
 * 화면을 막는 일은 여전히 서버의 PermissionGate 와 DB(RLS)가 한다.
 */
export interface CurrentUser extends PermissionSubject {
  id: string;
  name: string;
  department: string | null;
}

const CurrentUserContext = createContext<CurrentUser | null>(null);

export function CurrentUserProvider({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext);
}
