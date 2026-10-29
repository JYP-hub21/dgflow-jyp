import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/get-user';
import { homePathFor } from '@/lib/auth/role-guard';

/** 쓸 수 있는 첫 화면으로 보낸다. 대시보드 권한이 없는 사원도 있다 */
export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  redirect(homePathFor(user) ?? '/dashboard');
}
