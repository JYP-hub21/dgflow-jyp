import { createServerSupabaseClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft } from 'lucide-react';
import { groupBySpec } from '@/lib/erp/grouping';
import ExcelDownloadButton from '@/components/order/ExcelDownloadButton';

export default async function ErpPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: order } = await supabase
    .from('dgflow_orders')
    .select(`*, customer:dgflow_customers(name, short_name), site:dgflow_sites(site_name)`)
    .eq('id', id).single();

  if (!order) notFound();

  const { data: items } = await supabase
    .from('dgflow_order_items')
    .select('*')
    .eq('order_id', id)
    .order('sort_order');

  const customer = order.customer as { name: string; short_name: string };
  const site = order.site as { site_name: string };
  const grouped = groupBySpec(items || []);
  const originalCount = items?.length || 0;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/orders/${id}`}>
            <Button variant="outline" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />돌아가기</Button>
          </Link>
          <h1 className="text-2xl font-bold">ERP 데이터 미리보기</h1>
        </div>
        <ErpExcelButton orderId={id} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            규격 그룹핑 결과 ({originalCount}행 → {grouped.length}행)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>품명</TableHead>
                <TableHead className="text-right">가로</TableHead>
                <TableHead className="text-right">세로</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead className="text-right">면적(m²)</TableHead>
                <TableHead>위치(묶음)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-medium">{item.product_name}</TableCell>
                  <TableCell className="text-right">{item.width_mm}</TableCell>
                  <TableCell className="text-right">{item.height_mm}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">
                    {(item.width_mm * item.height_mm * item.quantity / 1_000_000).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-xs max-w-[300px] truncate">{item.location_summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 text-sm text-gray-500">
          <p>ERP 엑셀 양식: 주문번호, 주문일자, 납품일자, 거래처, 현장명, 구분(TP), 품명, 두께, 가로규격, 세로규격, 주문수량, 출고수량, 잔여수량, 면적, 미출고액, 비고 (16열)</p>
        </CardContent>
      </Card>
    </div>
  );
}

function ErpExcelButton({ orderId }: { orderId: string }) {
  return (
    <a href={`/api/orders/${orderId}/erp-excel`} download>
      <Button>ERP 엑셀 다운로드</Button>
    </a>
  );
}
