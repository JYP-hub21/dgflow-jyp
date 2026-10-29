import Link from 'next/link';
import { format } from 'date-fns';
import { ChevronRight, Inbox, Upload } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { canProcess, listPurchaseOrders, type PoSummary } from '@/lib/purchase-order/server';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import { chipClass, chipCountClass } from '@/components/ui/chip';
import PageHeader from '@/components/layout/PageHeader';
import { StageBadge, StageSteps } from '@/components/purchase-order/StageBadge';
import StorageUsage from '@/components/purchase-order/StorageUsage';

type View = 'todo' | 'mine' | 'open' | 'all';

/**
 * 발주서 접수함 — 파이프라인의 출발점.
 *  · 나에게 온 것: 내가 담당자인데 아직 생산까지 안 넘어간 건
 *  · 내가 올린 것: 담당자가 확인했는지, 어디까지 갔는지
 *  · 진행 중 / 전체
 */
export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = (await getCurrentUser())!;
  const params = await searchParams;
  const processor = canProcess(user);
  const view: View = (['todo', 'mine', 'open', 'all'] as const).includes(params.view as View)
    ? params.view as View
    : processor ? 'todo' : 'mine';

  const supabase = createServiceRoleClient();
  const all = await listPurchaseOrders(supabase);

  const active = (p: PoSummary) => p.derived !== 'done' && p.derived !== 'cancelled';
  const lists: Record<View, PoSummary[]> = {
    todo: all.filter(p => p.assignee_id === user.id && active(p) && !['producing'].includes(p.derived)),
    mine: all.filter(p => p.created_by === user.id),
    open: all.filter(active),
    all,
  };
  const shown = lists[view];
  const tabs: { key: View; label: string; hidden?: boolean }[] = [
    { key: 'todo', label: '나에게 온 것', hidden: !processor },
    { key: 'mine', label: '내가 올린 것' },
    { key: 'open', label: '진행 중' },
    { key: 'all', label: '전체' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="발주서"
        description="발주서를 올리고 담당자를 지목하면, 담당자가 언제 확인했고 지금 어디까지 왔는지 여기서 보입니다."
        actions={hasPermission(user, 'order:submit') && (
          <Link href="/purchase-orders/new" className={buttonVariants()}>
            <Upload />발주서 올리기
          </Link>
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        {tabs.filter(t => !t.hidden).map(t => (
          <Link key={t.key} href={`/purchase-orders?view=${t.key}`} className={chipClass(view === t.key)}>
            {t.label}<span className={chipCountClass(view === t.key)}>{lists[t.key].length}</span>
          </Link>
        ))}
        {user.role === 'master' && <StorageUsage />}
      </div>

      {/* 폰 — 카드 */}
      <div className="space-y-2.5 md:hidden">
        {shown.length === 0 && <Empty view={view} />}
        {shown.map(p => (
          <Link key={p.id} href={`/purchase-orders/${p.id}`}
            className="block rounded-xl border bg-card px-4 py-3.5 shadow-xs active:bg-brand-50">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{p.site_name || p.customer_name || p.intake_number}</span>
              <StageBadge stage={p.derived} stalledDays={p.stalled_days} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {p.intake_number} · {p.creator_name} → {p.assignee_name ?? '-'}
            </p>
            <StageSteps stage={p.derived} compact />
          </Link>
        ))}
      </div>

      {/* PC — 표 */}
      <Card className="hidden py-0 md:flex">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">접수번호</TableHead>
                <TableHead>현장 · 거래처</TableHead>
                <TableHead>올린 사람 → 담당자</TableHead>
                <TableHead>담당자 확인</TableHead>
                <TableHead>진행</TableHead>
                <TableHead>납기</TableHead>
                <TableHead className="pr-5"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="p-6"><Empty view={view} /></TableCell></TableRow>
              ) : shown.map(p => (
                <TableRow key={p.id} className={p.derived === 'cancelled' ? 'opacity-50' : ''}>
                  <TableCell className="pl-5">
                    <Link href={`/purchase-orders/${p.id}`} className="font-bold text-brand-800 hover:underline">{p.intake_number}</Link>
                    <p className="text-xs text-muted-foreground">{format(new Date(p.created_at), 'MM/dd HH:mm')}</p>
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <p className="truncate font-medium">{p.site_name || '-'}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.customer_name || ''}</p>
                  </TableCell>
                  <TableCell className="text-sm">{p.creator_name} → <b>{p.assignee_name ?? '-'}</b></TableCell>
                  <TableCell className="text-sm">
                    {p.checked_at
                      ? <span className="text-success">✓ {format(new Date(p.checked_at), 'MM/dd HH:mm')}</span>
                      : p.derived === 'cancelled' ? '-' : <span className="font-semibold text-warning">아직 안 봄</span>}
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={p.derived} stalledDays={p.stalled_days} />
                    <div className="mt-1.5"><StageSteps stage={p.derived} compact /></div>
                    {p.packages_total > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">작업의뢰서 {p.packages_linked}/{p.packages_total}</p>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-sm">{p.due_date || '-'}</TableCell>
                  <TableCell className="pr-5">
                    <Link href={`/purchase-orders/${p.id}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                      열기<ChevronRight />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Empty({ view }: { view: View }) {
  const text = view === 'todo' ? '나에게 온 발주서가 없습니다.'
    : view === 'mine' ? '올린 발주서가 없습니다.' : '발주서가 없습니다.';
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
      <Inbox className="h-8 w-8" />{text}
    </div>
  );
}
