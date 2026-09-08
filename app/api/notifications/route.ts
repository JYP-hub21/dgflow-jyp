import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { NextRequest, NextResponse } from 'next/server';

// GET: 내 알림 목록
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from('dgflow_notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const unreadCount = (data || []).filter(n => !n.is_read).length;

  return NextResponse.json({ data: data || [], unreadCount });
}

// PATCH: 알림 읽음 처리
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, readAll } = await request.json();
  const supabase = await createServerSupabaseClient();

  if (readAll) {
    await supabase
      .from('dgflow_notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
  } else if (id) {
    await supabase
      .from('dgflow_notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', user.id);
  }

  return NextResponse.json({ success: true });
}
