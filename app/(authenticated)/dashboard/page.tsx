import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { USER_ROLES } from '@/types/user';
import { ORDER_STATUS, type OrderStatus } from '@/types/order-status';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import OrderTrendChart from '@/components/dashboard/OrderTrendChart';
import { format, subDays } from 'date-fns';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();

  // 모든 쿼리를 병렬 실행 (순차 → 병렬로 로딩 속도 개선)
  const monthStart = new Date();
  monthStart.setDate(1);
  const weekLater = new Date();
  weekLater.setDate(weekLater.getDate() + 7);
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  const [
    { count: totalOrders },
    { data: statusCounts },
    { data: monthOrders },
    { data: urgentOrders },
    { data: recentOrders },
    { data: trendOrders },
  ] = await Promise.all([
    supabase.from('dgflow_orders').select('*', { count: 'exact', head: true }),
    supabase.from('dgflow_orders').select('status'),
    supabase.from('dgflow_orders').select('total_quantity, total_area_m2')
      .gte('order_date', monthStart.toISOString().split('T')[0]),
    supabase.from('dgflow_orders')
      .select(`*, customer:dgflow_customers(short_name), site:dgflow_sites(site_name)`)
      .lte('delivery_date', weekLater.toISOString().split('T')[0])
      .not('status', 'in', '("production_completed","erp_completed")')
      .order('delivery_date').limit(10),
    supabase.from('dgflow_orders')
      .select(`*, customer:dgflow_customers(short_name), site:dgflow_sites(site_name), creator:dgflow_users!created_by(name)`)
      .order('created_at', { ascending: false }).limit(5),
    supabase.from('dgflow_orders')
      .select('order_date, total_quantity, total_area_m2')
      .gte('order_date', thirtyDaysAgo),
  ]);

  const statusMap = new Map<string, number>();
  (statusCounts || []).forEach(o => {
    statusMap.set(o.status, (statusMap.get(o.status) || 0) + 1);
  });

  const monthQuantity = (monthOrders || []).reduce((s, o) => s + o.total_quantity, 0);
  const monthArea = (monthOrders || []).reduce((s, o) => s + Number(o.total_area_m2), 0);

  const trendMap = new Map<string, { count: number; quantity: number; area: number }>();
  (trendOrders || []).forEach(o => {
    const date = o.order_date;
    const prev = trendMap.get(date) || { count: 0, quantity: 0, area: 0 };
    trendMap.set(date, {
      count: prev.count + 1,
      quantity: prev.quantity + o.total_quantity,
      area: prev.area + Number(o.total_area_m2),
    });
  });
  const trendData = [...trendMap.entries()]
    .map(([date, v]) => ({ date: date.slice(5), ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 거래처별 집계
  const { data: customerStats } = await supabase
    .from('dgflow_orders')
    .select('customer:dgflow_customers(short_name), total_quantity, total_area_m2');

  const customerMap = new Map<string, { count: number; quantity: number; area: number }>();
  (customerStats || []).forEach(o => {
    const cust = o.customer as { short_name: string } | { short_name: string }[] | null;
    const name = (Array.isArray(cust) ? cust[0]?.short_name : cust?.short_name) || '기타';
    const prev = customerMap.get(name) || { count: 0, quantity: 0, area: 0 };
    customerMap.set(name, {
      count: prev.count + 1,
      quantity: prev.quantity + o.total_quantity,
      area: prev.area + Number(o.total_area_m2),
    });
  });
  const topCustomers = [...customerMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  const pendingCount = (statusMap.get('pending_customer') || 0)
    + (statusMap.get('under_review') || 0)
    + (statusMap.get('pending_approval') || 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">대시보드</h1>
        <p className="text-sm text-gray-500">환영합니다, {user?.name}님 ({user ? USER_ROLES[user.role] : ''})</p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-gray-500">전체 주문</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{totalOrders || 0}</p><p className="text-xs text-gray-500">건</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-gray-500">처리 대기</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-orange-600">{pendingCount}</p><p className="text-xs text-gray-500">승인/검토 대기</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-gray-500">이번 달 수량</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{monthQuantity}</p><p className="text-xs text-gray-500">개</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-gray-500">이번 달 면적</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{monthArea.toFixed(1)}</p><p className="text-xs text-gray-500">m²</p></CardContent>
        </Card>
      </div>

      {/* 상태 파이프라인 */}
      <Card>
        <CardHeader><CardTitle className="text-lg">주문 상태 현황</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {Object.entries(ORDER_STATUS).map(([key, label]) => {
              const count = statusMap.get(key) || 0;
              return (
                <div key={key} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 min-w-[120px]">
                  <span className="text-sm text-gray-600">{label}</span>
                  <Badge variant={count > 0 ? 'default' : 'secondary'}>{count}</Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 주문 추이 차트 */}
      <Card>
        <CardHeader><CardTitle className="text-lg">최근 30일 주문 추이</CardTitle></CardHeader>
        <CardContent>
          <OrderTrendChart data={trendData} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* 납기 임박 */}
        <Card>
          <CardHeader><CardTitle className="text-lg">납기 임박 (7일 이내)</CardTitle></CardHeader>
          <CardContent>
            {(!urgentOrders || urgentOrders.length === 0) ? (
              <p className="text-sm text-gray-500 py-4 text-center">임박한 납기가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {urgentOrders.map(o => (
                  <Link key={o.id} href={`/orders/${o.id}`} className="flex items-center justify-between py-2 px-3 rounded hover:bg-gray-50">
                    <div>
                      <span className="font-medium text-sm">{(o.customer as { short_name: string }).short_name}</span>
                      <span className="text-xs text-gray-500 ml-2">{(o.site as { site_name: string }).site_name}</span>
                    </div>
                    <Badge variant="destructive" className="text-xs">{o.delivery_date}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 거래처별 현황 */}
        <Card>
          <CardHeader><CardTitle className="text-lg">거래처별 주문 현황 (Top 5)</CardTitle></CardHeader>
          <CardContent>
            {topCustomers.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">데이터가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {topCustomers.map(([name, stats]) => (
                  <div key={name} className="flex items-center justify-between py-2 px-3 rounded bg-gray-50">
                    <span className="font-medium text-sm">{name}</span>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>{stats.count}건</span>
                      <span>{stats.quantity}개</span>
                      <span>{stats.area.toFixed(1)}m²</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 최근 주문 */}
      <Card>
        <CardHeader><CardTitle className="text-lg">최근 주문</CardTitle></CardHeader>
        <CardContent>
          {(!recentOrders || recentOrders.length === 0) ? (
            <p className="text-sm text-gray-500 py-4 text-center">주문이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {recentOrders.map(o => (
                <Link key={o.id} href={`/orders/${o.id}`} className="flex items-center justify-between py-2 px-3 rounded hover:bg-gray-50">
                  <div>
                    <span className="font-medium text-sm">{(o.customer as { short_name: string })?.short_name}</span>
                    <span className="text-xs text-gray-500 ml-2">{(o.site as { site_name: string })?.site_name}</span>
                    <span className="text-xs text-gray-400 ml-2">by {(o.creator as { name: string })?.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{o.total_quantity}개 / {o.total_area_m2}m²</span>
                    <Badge variant="secondary">{ORDER_STATUS[o.status as OrderStatus]}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
