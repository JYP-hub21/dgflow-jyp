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

  return data as DgflowUser | null;
}
