import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { workOrderLabels, type WorkOrderLabelSource } from '@/lib/work-order/labels';
import { SITE_SELECT, toWorkOrderSite } from '@/lib/work-order/site';
import PageHeader from '@/components/layout/PageHeader';
import SiteBadge from '@/components/work-order/SiteBadge';
import DeliveryPanel, { type DeliveryItem } from '@/components/production/DeliveryPanel';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { Factory, FileCheck } from 'lucide-react';

/** 납품 입력 — 작업의뢰서 하나. 납품 메뉴의 "납품 입력" 에서 들어온다 */
export default async function DeliveryInputPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceRoleClient();

  const [{ data: workOrder }, user] = await Promise.all([
    supabase
      .from('dgflow_work_orders')
      .select(`
        id, work_order_number, customer_label, site_label, delivery_date, ${SITE_SELECT},
        order:dgflow_orders(customer:dgflow_customers(short_name), site:dgflow_sites(site_name)),
        items:dgflow_work_order_items(id, product_name, width_mm, height_mm, quantity, produced_quantity, area_m2, remark, sort_order, item_no)
      `)
      .eq('id', id)
      .single(),
    getCurrentUser(),
  ]);
  if (!workOrder) notFound();

  const labels = workOrderLabels(workOrder as unknown as WorkOrderLabelSource);
  const site = toWorkOrderSite(workOrder);
  const items = ((workOrder.items ?? []) as DeliveryItem[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        back={{ href: '/deliveries', label: '납품' }}
        title={<>납품 입력 <span className="font-semibold text-muted-foreground">{workOrder.work_order_number}</span></>}
        description={<>
          {[labels.customer, labels.site].filter(Boolean).join(' · ') || '-'}
          {workOrder.delivery_date && ` · 납기 ${workOrder.delivery_date}`}
          {site?.site === 'outsource' && <SiteBadge value={site} className="ml-2 align-middle" />}
        </>}
        actions={<>
          <Link href={`/work-orders/${id}`} className={buttonVariants({ variant: 'outline' })}><FileCheck />작업의뢰서</Link>
          <Link href={`/production/${id}`} className={buttonVariants({ variant: 'outline' })}><Factory />생산 입력</Link>
        </>}
      />
      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          <DeliveryPanel workOrderId={id} items={items} defaultDate={today}
            canEdit={!!user && hasPermission(user, 'production:input')} />
        </CardContent>
      </Card>
    </div>
  );
}
