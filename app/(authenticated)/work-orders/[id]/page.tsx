import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Factory, Scissors, FileSpreadsheet, Printer } from 'lucide-react';

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceRoleClient();

  // 작업의뢰서 기본 정보
  const { data: workOrder } = await supabase
    .from('dgflow_work_orders')
    .select(`
      *,
      order:dgflow_orders(
        order_number, order_date, delivery_date, remark,
        customer:dgflow_customers(name, short_name),
        site:dgflow_sites(site_name),
        creator:dgflow_users!created_by(name)
      )
    `)
    .eq('id', id)
    .single();

  if (!workOrder) notFound();

  const order = workOrder.order as {
    order_number: string; order_date: string; delivery_date: string; remark: string;
    customer: { name: string; short_name: string };
    site: { site_name: string };
    creator: { name: string };
  };

  // 품목 목록 + 생산 진행률
  const { data: items } = await supabase
    .from('dgflow_work_order_items')
    .select('*')
    .eq('work_order_id', id)
    .order('sort_order');

  const woItems = items || [];
  const totalQty = woItems.reduce((s, i) => s + i.quantity, 0);
  const totalProduced = woItems.reduce((s, i) => s + i.produced_quantity, 0);
  const overallProgress = totalQty > 0 ? Math.round(totalProduced / totalQty * 100) : 0;

  // 복층 생산 이력
  const { data: productionLogs } = await supabase
    .from('dgflow_production_logs')
    .select('*, created_by_user:dgflow_users!created_by(name)')
    .eq('work_order_id', id)
    .order('production_date', { ascending: false })
    .limit(20);

  // 재단 이력
  const { data: cuttingLogs } = await supabase
    .from('dgflow_cutting_logs')
    .select('*, created_by_user:dgflow_users!created_by(name)')
    .eq('work_order_id', id)
    .order('cutting_date', { ascending: false })
    .limit(20);

  const WO_STATUS: Record<string, { label: string; color: string }> = {
    pending: { label: '대기', color: 'bg-gray-100 text-gray-800' },
    in_progress: { label: '진행중', color: 'bg-blue-100 text-blue-800' },
    completed: { label: '완료', color: 'bg-green-100 text-green-800' },
  };

  const statusInfo = WO_STATUS[workOrder.status] || WO_STATUS.pending;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">작업의뢰서 {workOrder.work_order_number}</h1>
            <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
          </div>
          <p className="text-gray-500 mt-1">
            {order.customer.short_name} / {order.site.site_name}
          </p>
        </div>
        <div className="text-right text-sm text-gray-500">
          <p>의뢰일: {workOrder.request_date}</p>
          <p>납품일: {workOrder.delivery_date || order.delivery_date || '-'}</p>
          <p>작성자: {order.creator.name}</p>
        </div>
      </div>

      {/* 전체 진행률 */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">전체 생산 진행률</span>
            <span className="text-sm font-bold">{totalProduced} / {totalQty} ({overallProgress}%)</span>
          </div>
          <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${overallProgress === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* 품목별 진행률 */}
      <Card>
        <CardHeader><CardTitle className="text-lg">품목별 생산 현황</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No</TableHead>
                <TableHead>품명</TableHead>
                <TableHead className="text-right">규격</TableHead>
                <TableHead className="text-right">의뢰</TableHead>
                <TableHead className="text-right">완료</TableHead>
                <TableHead className="text-right">잔여</TableHead>
                <TableHead>진행률</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {woItems.map((item, idx) => {
                const remaining = item.quantity - item.produced_quantity;
                const progress = item.quantity > 0 ? Math.round(item.produced_quantity / item.quantity * 100) : 0;
                const isComplete = remaining <= 0;
                return (
                  <TableRow key={item.id} className={isComplete ? 'bg-green-50' : ''}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell className="font-medium">{item.product_name}</TableCell>
                    <TableCell className="text-right text-sm">{item.width_mm}×{item.height_mm}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right font-medium">{item.produced_quantity}</TableCell>
                    <TableCell className="text-right">
                      {isComplete ? <Badge className="bg-green-100 text-green-800">완료</Badge> : remaining}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${isComplete ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${progress}%` }} />
                        </div>
                        <span className="text-xs text-gray-600">{progress}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 액션 버튼 */}
      <div className="flex gap-3 flex-wrap">
        <Link href={`/production/${id}`}>
          <Button><Factory className="mr-2 h-4 w-4" />복층 생산 입력</Button>
        </Link>
        <Link href={`/cutting/${id}`}>
          <Button variant="outline"><Scissors className="mr-2 h-4 w-4" />재단 입력</Button>
        </Link>
        {workOrder.order_id && (
          <Link href={`/orders/${workOrder.order_id}/erp-preview`}>
            <Button variant="outline"><FileSpreadsheet className="mr-2 h-4 w-4" />ERP 엑셀</Button>
          </Link>
        )}
      </div>

      {/* 생산 이력 + 재단 이력 */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* 복층 생산 이력 */}
        <Card>
          <CardHeader><CardTitle className="text-lg">복층 생산 이력 ({(productionLogs || []).length}건)</CardTitle></CardHeader>
          <CardContent>
            {(!productionLogs || productionLogs.length === 0) ? (
              <p className="text-sm text-gray-500 text-center py-4">생산 이력이 없습니다</p>
            ) : (
              <div className="space-y-2">
                {productionLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between py-2 px-3 rounded bg-gray-50 text-sm">
                    <div>
                      <span className="font-medium">{log.production_date}</span>
                      <span className="text-gray-500 ml-2">{log.quantity_completed}건</span>
                      {log.area_m2 && <span className="text-gray-400 ml-1">({Number(log.area_m2).toFixed(1)}m²)</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{log.shift === 'night' ? '야간' : '주간'}</span>
                      <span>{log.line_number}호기</span>
                      <span>{(log.created_by_user as { name: string } | null)?.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 재단 이력 */}
        <Card>
          <CardHeader><CardTitle className="text-lg">재단 이력 ({(cuttingLogs || []).length}건)</CardTitle></CardHeader>
          <CardContent>
            {(!cuttingLogs || cuttingLogs.length === 0) ? (
              <p className="text-sm text-gray-500 text-center py-4">재단 이력이 없습니다</p>
            ) : (
              <div className="space-y-2">
                {cuttingLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between py-2 px-3 rounded bg-gray-50 text-sm">
                    <div>
                      <span className="font-medium">{log.cutting_date}</span>
                      <span className="text-gray-500 ml-2">{log.product_name}</span>
                      <span className="text-gray-500 ml-1">×{log.quantity}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {log.raw_glass_type && <span>원판: {log.raw_glass_type} ×{log.raw_quantity}</span>}
                      {log.is_manual && <Badge variant="secondary" className="text-[10px]">오도시</Badge>}
                      <span>{log.shift === 'night' ? '야간' : '주간'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Link href="/work-orders">
        <Button variant="outline">목록으로</Button>
      </Link>
    </div>
  );
}
