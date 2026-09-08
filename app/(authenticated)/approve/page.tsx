import { createServerSupabaseClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ORDER_STATUS, type OrderStatus } from '@/types/order-status';
import Link from 'next/link';
import Pagination from '@/components/ui/pagination';

const PAGE_SIZE = 20;

export default async function ApprovePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const page = parseInt(params.page || '1');
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createServerSupabaseClient();

  const { data: orders, count } = await supabase
    .from('dgflow_orders')
    .select(`*, customer:dgflow_customers(short_name), site:dgflow_sites(site_name), creator:dgflow_users!created_by(name)`, { count: 'exact' })
    .in('status', ['review_completed', 'pending_approval', 'final_approved'])
    .order('updated_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">승인</h1>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>거래처</TableHead>
                <TableHead>현장</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead className="text-right">면적(m²)</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>작성자</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!orders || orders.length === 0) ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500">승인 대기 주문이 없습니다.</TableCell></TableRow>
              ) : orders.map(order => (
                <TableRow key={order.id}>
                  <TableCell>{(order.customer as { short_name: string }).short_name}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{(order.site as { site_name: string }).site_name}</TableCell>
                  <TableCell className="text-right">{order.total_quantity}</TableCell>
                  <TableCell className="text-right">{order.total_area_m2}</TableCell>
                  <TableCell><Badge variant="secondary">{ORDER_STATUS[order.status as OrderStatus]}</Badge></TableCell>
                  <TableCell>{(order.creator as { name: string }).name}</TableCell>
                  <TableCell><Link href={`/orders/${order.id}`} className="text-blue-600 hover:underline text-sm">상세</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Pagination totalCount={count || 0} pageSize={PAGE_SIZE} />
    </div>
  );
}
