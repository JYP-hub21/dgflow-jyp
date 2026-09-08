import React from 'react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { groupByProduct, calculateTotals } from '@/lib/calc/subtotal';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download } from 'lucide-react';
import ExcelDownloadButton from '@/components/order/ExcelDownloadButton';
import PrintButton from '@/components/order/PrintButton';

export default async function OrderPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: order } = await supabase
    .from('dgflow_orders')
    .select(`*, customer:dgflow_customers(name), site:dgflow_sites(site_name, address), creator:dgflow_users!created_by(name)`)
    .eq('id', id).single();

  if (!order) notFound();

  const { data: items } = await supabase
    .from('dgflow_order_items')
    .select('*')
    .eq('order_id', id)
    .order('sort_order');

  // 결재 이력 조회 (검토/승인 단계별 처리자)
  const { data: statusLogs } = await supabase
    .from('dgflow_order_status_logs')
    .select('to_status, changed_by_user:dgflow_users!changed_by(name)')
    .eq('order_id', id)
    .order('created_at');

  // 결재란 이름 추출
  const reviewer = (statusLogs || []).find(l => l.to_status === 'review_completed');
  const approver = (statusLogs || []).find(l => l.to_status === 'final_approved');
  function extractName(user: unknown): string {
    if (!user) return '';
    if (Array.isArray(user)) return user[0]?.name || '';
    return (user as { name: string }).name || '';
  }
  const reviewerName = extractName(reviewer?.changed_by_user);
  const approverName = extractName(approver?.changed_by_user);

  const customer = order.customer as { name: string };
  const site = order.site as { site_name: string; address: string };
  const creator = order.creator as { name: string };
  const orderItems = items || [];
  const groups = groupByProduct(orderItems);
  const totals = calculateTotals(orderItems);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between no-print">
        <Link href={`/orders/${id}`}>
          <Button variant="outline" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />돌아가기</Button>
        </Link>
        <div className="flex gap-2">
          <ExcelDownloadButton orderId={id} />
          <PrintButton />
        </div>
      </div>

      {/* 주문의뢰서 양식 */}
      <Card className="print:shadow-none print:border-2 print:border-black">
        <CardContent className="p-8">
          {/* 헤더 */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold mb-1">주 문 의 뢰 서</h1>
            <p className="text-sm text-gray-500">동일유리(주)</p>
          </div>

          {/* 기본 정보 테이블 */}
          <table className="w-full border-collapse border border-gray-400 mb-6 text-sm">
            <tbody>
              <tr>
                <td className="border border-gray-400 bg-gray-100 px-3 py-1.5 font-medium w-24">업체명</td>
                <td className="border border-gray-400 px-3 py-1.5">{customer.name}</td>
                <td className="border border-gray-400 bg-gray-100 px-3 py-1.5 font-medium w-24">의뢰일자</td>
                <td className="border border-gray-400 px-3 py-1.5">{order.order_date}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 bg-gray-100 px-3 py-1.5 font-medium">현장명</td>
                <td className="border border-gray-400 px-3 py-1.5" colSpan={1}>{site.site_name}</td>
                <td className="border border-gray-400 bg-gray-100 px-3 py-1.5 font-medium">납품일자</td>
                <td className="border border-gray-400 px-3 py-1.5">{order.delivery_date || '-'}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 bg-gray-100 px-3 py-1.5 font-medium">작성자</td>
                <td className="border border-gray-400 px-3 py-1.5" colSpan={3}>{creator.name}</td>
              </tr>
            </tbody>
          </table>

          {/* 결재란 */}
          <table className="border-collapse border border-gray-400 mb-6 text-xs ml-auto">
            <thead>
              <tr>
                <th className="border border-gray-400 bg-gray-100 px-4 py-1">작성</th>
                <th className="border border-gray-400 bg-gray-100 px-4 py-1">검토</th>
                <th className="border border-gray-400 bg-gray-100 px-4 py-1">검토</th>
                <th className="border border-gray-400 bg-gray-100 px-4 py-1">승인</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-400 px-4 py-4 text-center">{creator.name}</td>
                <td className="border border-gray-400 px-4 py-4 text-center">{reviewerName}</td>
                <td className="border border-gray-400 px-4 py-4 text-center"></td>
                <td className="border border-gray-400 px-4 py-4 text-center">{approverName}</td>
              </tr>
            </tbody>
          </table>

          {/* 품목 테이블 (품명별 그룹) */}
          <table className="w-full border-collapse border border-gray-400 text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-400 px-2 py-1.5 w-10">No</th>
                <th className="border border-gray-400 px-2 py-1.5">품명</th>
                <th className="border border-gray-400 px-2 py-1.5">규격(가로×세로)</th>
                <th className="border border-gray-400 px-2 py-1.5 w-16">수량</th>
                <th className="border border-gray-400 px-2 py-1.5 w-20">면적(m²)</th>
                <th className="border border-gray-400 px-2 py-1.5">비고</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, gi) => (
                <React.Fragment key={gi}>
                  {group.items.map((item: typeof orderItems[0], ii: number) => (
                    <tr key={item.id}>
                      <td className="border border-gray-400 px-2 py-1 text-center">{gi * 100 + ii + 1}</td>
                      <td className="border border-gray-400 px-2 py-1">{ii === 0 ? group.product_name : ''}</td>
                      <td className="border border-gray-400 px-2 py-1 text-center">{item.width_mm} × {item.height_mm}</td>
                      <td className="border border-gray-400 px-2 py-1 text-right">{item.quantity}</td>
                      <td className="border border-gray-400 px-2 py-1 text-right">{Number(item.area_m2).toFixed(2)}</td>
                      <td className="border border-gray-400 px-2 py-1 text-xs">
                        {[item.location_dong && `${item.location_dong}동`, item.location_line && `${item.location_line}라인`, item.location_floor && `(${item.location_floor}층)`, item.location_room, item.remark].filter(Boolean).join(' ')}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-medium">
                    <td className="border border-gray-400 px-2 py-1" colSpan={3} >소계 ({group.product_name})</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{group.subtotal_quantity}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{group.subtotal_area.toFixed(2)}</td>
                    <td className="border border-gray-400 px-2 py-1"></td>
                  </tr>
                </React.Fragment>
              ))}
              <tr className="bg-gray-200 font-bold">
                <td className="border border-gray-400 px-2 py-1.5" colSpan={3}>합 계</td>
                <td className="border border-gray-400 px-2 py-1.5 text-right">{totals.total_quantity}</td>
                <td className="border border-gray-400 px-2 py-1.5 text-right">{totals.total_area.toFixed(2)}</td>
                <td className="border border-gray-400 px-2 py-1.5"></td>
              </tr>
            </tbody>
          </table>

          {order.remark && (
            <div className="mt-4 text-sm">
              <span className="font-medium">비고:</span> {order.remark}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
