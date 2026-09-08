import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/orders/[id]/attachments/url?path=xxx - 서명된 다운로드 URL 생성
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const filePath = request.nextUrl.searchParams.get('path');
  if (!filePath || !filePath.startsWith(`${id}/`)) {
    return NextResponse.json({ error: '잘못된 파일 경로' }, { status: 400 });
  }

  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient.storage
    .from('order-attachments')
    .createSignedUrl(filePath, 300); // 5분 유효

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
