import { createServerSupabaseClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Link from 'next/link';
import Pagination from '@/components/ui/pagination';
import WorkOrderUploadButton from '@/components/work-order/UploadButton';

const WO_STATUS: Record<string, string> = { pending: '대기', in_progress: '진행중', completed: '완료' };
const PAGE_SIZE = 20;

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const page = parseInt(params.page || '1');
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createServerSupabaseClient();

  const { data: workOrders, count } = await supabase
    .from('dgflow_work_orders')
    .select(`*, order:dgflow_orders(order_number, customer:dgflow_customers(short_name), site:dgflow_sites(site_name))`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">작업의뢰서</h1>
        <WorkOrderUploadButton />
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>의뢰번호</TableHead>
                <TableHead>거래처</TableHead>
                <TableHead>현장</TableHead>
                <TableHead>의뢰일</TableHead>
                <TableHead>납품일</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>구분</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!workOrders || workOrders.length === 0) ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">작업의뢰서가 없습니다.</TableCell></TableRow>
              ) : workOrders.map(wo => {
                const order = wo.order as { order_number: string; customer: { short_name: string }; site: { site_name: string } } | null;
                const customerName = order?.customer?.short_name || wo.customer_name || '-';
                const siteName = order?.site?.site_name || wo.site_name || '-';
                const isUpload = wo.source === 'upload';
                return (
                  <TableRow key={wo.id}>
                    <TableCell className="font-medium">{wo.work_order_number}</TableCell>
                    <TableCell>{customerName}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{siteName}</TableCell>
                    <TableCell>{wo.request_date}</TableCell>
                    <TableCell>{wo.delivery_date || '-'}</TableCell>
                    <TableCell><Badge variant="secondary">{WO_STATUS[wo.status]}</Badge></TableCell>
                    <TableCell>
                      {isUpload
                        ? <Badge variant="outline" className="text-orange-600 border-orange-300">바이투</Badge>
                        : <Badge variant="outline" className="text-blue-600 border-blue-300">주문</Badge>
                      }
                    </TableCell>
                    <TableCell>
                      <Link href={`/work-orders/${wo.id}`} className="text-blue-600 hover:underline text-sm font-medium">상세</Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Pagination totalCount={count || 0} pageSize={PAGE_SIZE} />
    </div>
  );
}
