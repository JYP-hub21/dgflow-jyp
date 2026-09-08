import { createServiceRoleClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { groupByProduct, calculateTotals } from '@/lib/calc/subtotal';
import CustomerApprovalForm from '@/components/order/CustomerApprovalForm';

export default async function CustomerApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createServiceRoleClient();

  // 토큰 검증
  const { data: tokenData } = await supabase
    .from('dgflow_approval_tokens')
    .select('*, order:dgflow_orders(*, customer:dgflow_customers(name), site:dgflow_sites(site_name))')
    .eq('token', token)
    .single();

  if (!tokenData) notFound();

  // 만료 확인
  const isExpired = new Date(tokenData.expires_at) < new Date();
  const isUsed = !!tokenData.used_at;

  if (isExpired || isUsed) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 text-center">
            <p className="text-lg font-medium text-gray-900">
              {isUsed ? '이미 처리된 승인 요청입니다.' : '승인 링크가 만료되었습니다.'}
            </p>
            <p className="text-sm text-gray-500 mt-2">담당자에게 문의하세요.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const order = tokenData.order as {
    id: string; order_date: string; delivery_date: string; status: string; remark: string;
    customer: { name: string }; site: { site_name: string };
    created_by: string;
  };

  const { data: items } = await supabase
    .from('dgflow_order_items')
    .select('*')
    .eq('order_id', order.id)
    .order('sort_order');

  // 작성자 이름 조회
  const { data: creatorData } = await supabase
    .from('dgflow_users')
    .select('name')
    .eq('id', order.created_by)
    .single();
  const creatorName = creatorData?.name || '';

  const orderItems = items || [];
  const groups = groupByProduct(orderItems);
  const totals = calculateTotals(orderItems);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">주문의뢰서 확인</h1>
          <p className="text-gray-500">동일유리(주)</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-lg">기본 정보</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div><p className="text-xs text-gray-500">업체명</p><p className="font-medium">{order.customer.name}</p></div>
            <div><p className="text-xs text-gray-500">현장명</p><p className="font-medium">{order.site.site_name}</p></div>
            <div><p className="text-xs text-gray-500">주문일</p><p className="font-medium">{order.order_date}</p></div>
            <div><p className="text-xs text-gray-500">납품일</p><p className="font-medium">{order.delivery_date || '-'}</p></div>
          </CardContent>
        </Card>

        {/* 결재란 */}
        <Card>
          <CardContent className="pt-6">
            <table className="border-collapse border border-gray-400 text-xs ml-auto">
              <thead>
                <tr>
                  <th className="border border-gray-400 bg-gray-100 px-6 py-1">작성</th>
                  <th className="border border-gray-400 bg-gray-100 px-6 py-1">검토</th>
                  <th className="border border-gray-400 bg-gray-100 px-6 py-1">승인</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-gray-400 px-6 py-3 text-center">{creatorName}</td>
                  <td className="border border-gray-400 px-6 py-3 text-center"></td>
                  <td className="border border-gray-400 px-6 py-3 text-center"></td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">품목 목록</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No</TableHead>
                  <TableHead>품명</TableHead>
                  <TableHead>규격</TableHead>
                  <TableHead className="text-right">수량</TableHead>
                  <TableHead className="text-right">면적(m²)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderItems.map((item, idx) => (
                  <TableRow key={item.id}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell>{item.product_name}</TableCell>
                    <TableCell>{item.width_mm} × {item.height_mm}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">{Number(item.area_m2).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-gray-50">
                  <TableCell colSpan={3}>합계</TableCell>
                  <TableCell className="text-right">{totals.total_quantity}</TableCell>
                  <TableCell className="text-right">{totals.total_area.toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <CustomerApprovalForm token={token} orderId={order.id} />
      </div>
    </div>
  );
}
