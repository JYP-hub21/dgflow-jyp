import { createServerSupabaseClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import Pagination from '@/components/ui/pagination';

const PAGE_SIZE = 20;

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const page = parseInt(params.page || '1');
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createServerSupabaseClient();

  const { data: workOrders, count } = await supabase
    .from('dgflow_work_orders')
    .select(`
      *,
      order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name)),
      items:dgflow_work_order_items(quantity, produced_quantity)
    `, { count: 'exact' })
    .in('status', ['pending', 'in_progress'])
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">생산 현황</h1>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>의뢰번호</TableHead>
                <TableHead>거래처</TableHead>
                <TableHead>현장</TableHead>
                <TableHead className="text-right">총수량</TableHead>
                <TableHead className="text-right">완료</TableHead>
                <TableHead>진행률</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!workOrders || workOrders.length === 0) ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500">진행 중인 생산이 없습니다.</TableCell></TableRow>
              ) : workOrders.map(wo => {
                const order = wo.order as { customer: { short_name: string }; site: { site_name: string } };
                const items = wo.items as { quantity: number; produced_quantity: number }[];
                const totalQty = items.reduce((s, i) => s + i.quantity, 0);
                const producedQty = items.reduce((s, i) => s + i.produced_quantity, 0);
                const progress = totalQty > 0 ? Math.round(producedQty / totalQty * 100) : 0;

                return (
                  <TableRow key={wo.id}>
                    <TableCell className="font-medium">{wo.work_order_number}</TableCell>
                    <TableCell>{order?.customer?.short_name}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{order?.site?.site_name}</TableCell>
                    <TableCell className="text-right">{totalQty}</TableCell>
                    <TableCell className="text-right">{producedQty}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${progress}%` }} />
                        </div>
                        <span className="text-xs text-gray-600">{progress}%</span>
                      </div>
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
