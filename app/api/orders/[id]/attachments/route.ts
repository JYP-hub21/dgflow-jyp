import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { EDITABLE_STATUSES } from '@/types/order-status';
import { NextRequest, NextResponse } from 'next/server';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_PER_ORDER = 10;
const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'application/pdf',
];

// GET /api/orders/[id]/attachments - 첨부파일 목록
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('dgflow_order_attachments')
    .select('*, uploader:dgflow_users!uploaded_by(name)')
    .eq('order_id', id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// POST /api/orders/[id]/attachments - 파일 업로드
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = await createServerSupabaseClient();
  const serviceClient = createServiceRoleClient();

  // 주문 상태 확인
  const { data: order } = await supabase
    .from('dgflow_orders')
    .select('status, created_by')
    .eq('id', id)
    .single();

  if (!order) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });

  // 편집 가능 상태에서만 업로드 허용
  if (!EDITABLE_STATUSES.includes(order.status)) {
    return NextResponse.json({ error: '현재 상태에서는 파일을 첨부할 수 없습니다.' }, { status: 400 });
  }

  // 기존 첨부파일 수 확인
  const { count } = await serviceClient
    .from('dgflow_order_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', id);

  if ((count || 0) >= MAX_FILES_PER_ORDER) {
    return NextResponse.json({ error: `최대 ${MAX_FILES_PER_ORDER}개까지 첨부할 수 있습니다.` }, { status: 400 });
  }

  // FormData 파싱
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const category = (formData.get('category') as string) || 'etc';

  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: '파일 크기는 10MB 이하여야 합니다.' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: '허용되지 않는 파일 형식입니다. (이미지, 엑셀, PDF만 가능)' }, { status: 400 });
  }

  // Storage 업로드
  const ext = file.name.split('.').pop() || '';
  const storagePath = `${id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const buffer = await file.arrayBuffer();

  const { error: uploadError } = await serviceClient.storage
    .from('order-attachments')
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: `업로드 실패: ${uploadError.message}` }, { status: 500 });
  }

  // DB 레코드 생성
  const { data: attachment, error: dbError } = await serviceClient
    .from('dgflow_order_attachments')
    .insert({
      order_id: id,
      file_name: file.name,
      file_path: storagePath,
      file_size: file.size,
      mime_type: file.type,
      category,
      uploaded_by: user.id,
    })
    .select('*, uploader:dgflow_users!uploaded_by(name)')
    .single();

  if (dbError) {
    // DB 실패 시 Storage 파일도 정리
    await serviceClient.storage.from('order-attachments').remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ data: attachment }, { status: 201 });
}

// DELETE /api/orders/[id]/attachments - 첨부파일 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { attachmentId } = await request.json();
  if (!attachmentId) return NextResponse.json({ error: 'attachmentId 필요' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const serviceClient = createServiceRoleClient();

  // 주문 상태 확인
  const { data: order } = await supabase
    .from('dgflow_orders')
    .select('status')
    .eq('id', id)
    .single();

  if (!order || !EDITABLE_STATUSES.includes(order.status)) {
    return NextResponse.json({ error: '현재 상태에서는 파일을 삭제할 수 없습니다.' }, { status: 400 });
  }

  // 첨부파일 조회
  const { data: attachment } = await serviceClient
    .from('dgflow_order_attachments')
    .select('file_path, uploaded_by')
    .eq('id', attachmentId)
    .eq('order_id', id)
    .single();

  if (!attachment) return NextResponse.json({ error: '첨부파일을 찾을 수 없습니다.' }, { status: 404 });

  // 본인 업로드 파일 또는 관리자만 삭제 가능
  if (attachment.uploaded_by !== user.id && !['biz_support', 'system_admin'].includes(user.role)) {
    return NextResponse.json({ error: '삭제 권한이 없습니다.' }, { status: 403 });
  }

  // Storage + DB 삭제
  await serviceClient.storage.from('order-attachments').remove([attachment.file_path]);
  await serviceClient.from('dgflow_order_attachments').delete().eq('id', attachmentId);

  return NextResponse.json({ success: true });
}
