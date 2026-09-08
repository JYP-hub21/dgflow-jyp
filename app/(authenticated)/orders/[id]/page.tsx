import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ORDER_STATUS, STATUS_COLORS, EDITABLE_STATUSES, ERP_DOWNLOADABLE_STATUSES, type OrderStatus } from '@/types/order-status';
import OrderActions from '@/components/order/OrderActions';
import OrderAttachments from '@/components/order/OrderAttachments';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FileText, FileSpreadsheet, Pencil, Trash2, Factory } from 'lucide-react';
import DeleteOrderButton from '@/components/order/DeleteOrderButton';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();

  const { data: order } = await supabase
    .from('dgflow_orders')
    .select(`
      *,
      customer:dgflow_customers(name, short_name),
      site:dgflow_sites(site_name, address),
      creator:dgflow_users!created_by(name, role)
    `)
    .eq('id', id)
    .single();

  if (!order) notFound();

  const { data: items } = await supabase
    .from('dgflow_order_items')
    .select('*, product:dgflow_products(display_name)')
    .eq('order_id', id)
    .order('sort_order');

  const { data: statusLogs } = await supabase
    .from('dgflow_order_status_logs')
    .select('*, changed_by_user:dgflow_users!changed_by(name)')
    .eq('order_id', id)
    .order('created_at', { ascending: false });

  // 첨부파일
  const serviceClient = createServiceRoleClient();
  const { data: attachments } = await serviceClient
    .from('dgflow_order_attachments')
    .select('*, uploader:dgflow_users!uploaded_by(name)')
    .eq('order_id', id)
    .order('created_at', { ascending: true });

  // 연결된 작업의뢰서
  const { data: workOrder } = await supabase
    .from('dgflow_work_orders')
    .select('id, work_order_number')
    .eq('order_id', id)
    .single();

  const customer = order.customer as { name: string; short_name: string };
  const site = order.site as { site_name: string; address: string };
  const creator = order.creator as { name: string; role: string };
  const status = order.status as OrderStatus;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">주문 상세</h1>
          <p className="text-gray-500">{customer.short_name} - {site.site_name}</p>
        </div>
        <Badge className={`text-base px-3 py-1 ${STATUS_COLORS[status]}`}>{ORDER_STATUS[status]}</Badge>
      </div>

      {/* 기본 정보 */}
      <Card>
        <CardHeader><CardTitle className="text-lg">기본 정보</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div><p className="text-xs text-gray-500">거래처</p><p className="font-medium">{customer.name}</p></div>
          <div><p className="text-xs text-gray-500">현장</p><p className="font-medium">{site.site_name}</p></div>
          <div><p className="text-xs text-gray-500">주문일</p><p className="font-medium">{order.order_date}</p></div>
          <div><p className="text-xs text-gray-500">납품일</p><p className="font-medium">{order.delivery_date || '-'}</p></div>
          <div><p className="text-xs text-gray-500">작성자</p><p className="font-medium">{creator.name}</p></div>
          <div><p className="text-xs text-gray-500">총 수량</p><p className="font-medium">{order.total_quantity}</p></div>
          <div><p className="text-xs text-gray-500">총 면적</p><p className="font-medium">{order.total_area_m2} m²</p></div>
          <div><p className="text-xs text-gray-500">비고</p><p className="font-medium">{order.remark || '-'}</p></div>
        </CardContent>
      </Card>

      {/* 품목 목록 */}
      <Card>
        <CardHeader><CardTitle className="text-lg">품목 ({items?.length || 0}건)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No</TableHead>
                <TableHead>품명</TableHead>
                <TableHead className="text-right">가로(mm)</TableHead>
                <TableHead className="text-right">세로(mm)</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead className="text-right">면적(m²)</TableHead>
                <TableHead>위치</TableHead>
                <TableHead>비고</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items?.map((item, idx) => (
                <TableRow key={item.id}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell className="font-medium">{item.product_name}</TableCell>
                  <TableCell className="text-right">{item.width_mm}</TableCell>
                  <TableCell className="text-right">{item.height_mm}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{item.area_m2}</TableCell>
                  <TableCell className="text-xs">
                    {[item.location_dong && `${item.location_dong}동`, item.location_line && `${item.location_line}라인`, item.location_floor && `(${item.location_floor}층)`, item.location_room].filter(Boolean).join(' ')}
                  </TableCell>
                  <TableCell className="text-xs">{item.remark || ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 참고자료 (첨부파일) */}
      <OrderAttachments
        orderId={id}
        editable={EDITABLE_STATUSES.includes(status) && !!user && (order.created_by === user.id || ['biz_support', 'system_admin'].includes(user.role))}
        initialAttachments={attachments || []}
      />

      {/* 액션 버튼 */}
      <div className="flex gap-3 flex-wrap">
        {EDITABLE_STATUSES.includes(status) &&
         user && (order.created_by === user.id || ['biz_support', 'system_admin'].includes(user.role)) && (
          <>
            <Link href={`/orders/${id}/edit`}>
              <Button variant="outline"><Pencil className="mr-2 h-4 w-4" />수정</Button>
            </Link>
            <DeleteOrderButton orderId={id} />
          </>
        )}
        <Link href={`/orders/${id}/preview`}>
          <Button variant="outline"><FileText className="mr-2 h-4 w-4" />주문의뢰서 보기</Button>
        </Link>
        {ERP_DOWNLOADABLE_STATUSES.includes(status) && (
          <Link href={`/orders/${id}/erp-preview`}>
            <Button variant="outline"><FileSpreadsheet className="mr-2 h-4 w-4" />ERP 엑셀</Button>
          </Link>
        )}
        {workOrder && (
          <Link href={`/work-orders/${workOrder.id}`}>
            <Button variant="outline"><Factory className="mr-2 h-4 w-4" />생산 현황 ({workOrder.work_order_number})</Button>
          </Link>
        )}
        {user && <OrderActions orderId={order.id} currentStatus={status} userRole={user.role} />}
      </div>

      {/* 상태 변경 이력 */}
      <Card>
        <CardHeader><CardTitle className="text-lg">상태 이력</CardTitle></CardHeader>
        <CardContent>
          {statusLogs?.map(log => (
            <div key={log.id} className="flex items-center gap-3 py-2 border-b last:border-0">
              <Badge variant="outline" className="text-xs">{ORDER_STATUS[log.to_status as OrderStatus] || log.to_status}</Badge>
              <span className="text-sm text-gray-600">{(log.changed_by_user as { name: string })?.name}</span>
              <span className="text-xs text-gray-400">{new Date(log.created_at).toLocaleString('ko-KR')}</span>
              {log.comment && <span className="text-xs text-gray-500">— {log.comment}</span>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
