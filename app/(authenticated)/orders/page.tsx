import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ORDER_STATUS, STATUS_COLORS, type OrderStatus } from '@/types/order-status';
import { Plus } from 'lucide-react';
import { hasPermission } from '@/lib/auth/role-guard';
import Pagination from '@/components/ui/pagination';

const PAGE_SIZE = 20;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const page = parseInt(params.page || '1');
  const offset = (page - 1) * PAGE_SIZE;

  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();

  const { data: orders, count } = await supabase
    .from('dgflow_orders')
    .select(`
      *,
      customer:dgflow_customers(name, short_name),
      site:dgflow_sites(site_name),
      creator:dgflow_users!created_by(name)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const totalCount = count || 0;
  const canCreate = user && hasPermission(user.role, 'orders:create');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">주문 관리</h1>
        {canCreate && (
          <Link href="/orders/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              새 주문
            </Button>
          </Link>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>주문번호</TableHead>
                <TableHead>거래처</TableHead>
                <TableHead>현장</TableHead>
                <TableHead>주문일</TableHead>
                <TableHead>납품일</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead className="text-right">면적(m2)</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>작성자</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!orders || orders.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                    주문이 없습니다. {canCreate && '새 주문을 생성하세요.'}
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order) => (
                  <TableRow key={order.id} className="cursor-pointer hover:bg-gray-50">
                    <TableCell>
                      <Link href={`/orders/${order.id}`} className="text-blue-600 hover:underline font-medium">
                        {order.order_number || `초안-${order.id.slice(0, 6)}`}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/orders/${order.id}`} className="hover:underline">
                        {(order.customer as { short_name: string })?.short_name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{(order.site as { site_name: string })?.site_name}</TableCell>
                    <TableCell>{order.order_date}</TableCell>
                    <TableCell>{order.delivery_date || '-'}</TableCell>
                    <TableCell className="text-right">{order.total_quantity}</TableCell>
                    <TableCell className="text-right">{order.total_area_m2}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[order.status as OrderStatus] || ''} variant="secondary">
                        {ORDER_STATUS[order.status as OrderStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell>{(order.creator as { name: string })?.name}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Pagination totalCount={totalCount} pageSize={PAGE_SIZE} />
    </div>
  );
}
