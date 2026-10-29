import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import type { DgflowUser } from '@/types/user';

export async function getCurrentUser(): Promise<DgflowUser | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  // service_role로 dgflow_users 조회 (RLS 우회)
  const adminClient = createServiceRoleClient();
  const { data } = await adminClient
    .from('dgflow_users')
    .select('*')
    .eq('auth_id', user.id)
    .single();

  // 승인 전이거나 사용을 멈춘 계정은 로그인 세션이 남아 있어도 없는 사람으로 본다
  const u = data as DgflowUser | null;
  if (!u || !u.is_active || u.status !== 'active') return null;
  return u;
}
