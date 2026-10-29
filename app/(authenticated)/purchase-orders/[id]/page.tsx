import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowRight, CheckCircle2, Clock, FileSpreadsheet, History } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/get-user';
import { hasPermission } from '@/lib/auth/role-guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { canProcess, listAssignees, loadPurchaseOrder, type PoEvent, type PoFile } from '@/lib/purchase-order/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';
import { StageBadge, StageSteps } from '@/components/purchase-order/StageBadge';
import { FileDownload, PackageRow, PoActions } from '@/components/purchase-order/PoControls';

const when = (iso: string) => format(new Date(iso), 'MM/dd HH:mm');

const EVENT_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  submitted: () => '발주서를 올렸습니다',
  downloaded: d => `파일을 받았습니다${d.file_name ? ` — ${d.file_name}` : ''}`,
  checked: () => '담당자가 확인했습니다',
  assigned: d => `담당자를 ${d.to_name ?? ''} 님으로 바꿨습니다`,
  erp_opened: () => 'ERP 변환 화면에서 열었습니다',
  erp_saved: d => `ERP 업로드 엑셀을 저장했습니다${d.sheet_name ? ` (${d.sheet_name})` : ''} — 포장 ${d.packages ?? 0}개`,
  linked: d => `작업의뢰서 ${d.work_order_number} → ${d.package} 연결 · ${d.summary ?? ''}`,
  unlinked: d => `작업의뢰서 ${d.work_order_number ?? ''} 연결을 끊었습니다 (${d.package})`,
  cancelled: () => '접수를 취소했습니다',
  edited: () => '내용을 고쳤습니다',
  purged: () => '저장 공간 정리로 파일을 지웠습니다',
};

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  const supabase = createServiceRoleClient();
  const po = await loadPurchaseOrder(supabase, id);
  if (!po) notFound();

  const processor = canProcess(user);
  const canErp = processor && hasPermission(user, 'erp:generate');
  const canLink = processor || hasPermission(user, 'work_order:create');
  const cancelled = po.derived === 'cancelled';
  const assignees = processor || po.created_by === user.id ? await listAssignees(supabase) : [];

  const orderFiles = po.files.filter(f => f.kind === 'order');
  const madeFiles = po.files.filter(f => f.kind !== 'order');
  const sheets = [...new Set(po.packages.map(p => p.sheet_name))];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        back={{ href: '/purchase-orders', label: '발주서' }}
        title={<span className="flex flex-wrap items-center gap-3">{po.site_name || po.customer_name || po.intake_number}<StageBadge stage={po.derived} stalledDays={po.stalled_days} /></span>}
        description={[po.intake_number, po.customer_name, po.due_date && `납기 ${po.due_date}`].filter(Boolean).join(' · ')}
      />

      {/* 흐름 — 누가 올렸고, 담당자가 언제 봤고, 지금 어디인가 */}
      <Card>
        <CardContent className="space-y-5 pt-6">
          <StageSteps stage={po.derived} />
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <Fact label="올린 사람" value={po.creator_name} sub={when(po.created_at)} />
            <Fact label="담당자" value={po.assignee_name ?? '-'} />
            <Fact
              label="담당자 확인"
              value={po.checked_at
                ? <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" />확인함</span>
                : cancelled ? '-' : <span className="flex items-center gap-1 text-warning"><Clock className="h-4 w-4" />아직 안 봄</span>}
              sub={po.checked_at ? `${po.checked_by_name} · ${when(po.checked_at)}` : undefined}
            />
          </div>
          {!cancelled && (processor || po.created_by === user.id) && (
            <PoActions
              poId={po.id}
              meId={user.id}
              assigneeId={po.assignee_id}
              canProcess={processor}
              canCancel={(po.created_by === user.id || user.role === 'master') && po.packages_linked === 0}
              assignees={assignees}
            />
          )}
        </CardContent>
      </Card>

      {po.memo && (
        <Card>
          <CardHeader><CardTitle className="text-base">전달 사항</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-wrap text-sm">{po.memo}</p></CardContent>
        </Card>
      )}

      {/* 다음에 할 일 */}
      {!cancelled && canErp && (po.derived === 'submitted' || po.derived === 'checked') && orderFiles.some(f => !f.purged_at) && (
        <NextStep
          title="다음 단계 — ERP 업로드 엑셀 만들기"
          text="올라온 발주서를 바로 열어 변환합니다. 만든 엑셀은 이 건에 저장되고, 포장마다 돌아올 작업의뢰서와 대조됩니다."
          href={`/erp-upload?po=${po.id}`}
          action="ERP 엑셀 만들기"
        />
      )}
      {!cancelled && po.derived === 'erp_ready' && (
        <NextStep
          title="다음 단계 — 회사 ERP 에 넣고 작업의뢰서 받아 오기"
          text="아래 ERP 엑셀을 받아 회사 ERP 에 넣으세요. ERP 가 뽑아 준 작업의뢰서를 포장마다 올리면 자동으로 대조합니다."
        />
      )}

      {/* 파일 */}
      <Card>
        <CardHeader><CardTitle className="text-base">파일</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <FileList title="발주서 원본" poId={po.id} files={orderFiles} />
          {madeFiles.length > 0 && <FileList title="만든 파일 (ERP 업로드 · 규격정리)" poId={po.id} files={madeFiles} />}
          {canErp && !cancelled && po.derived !== 'submitted' && po.derived !== 'checked' && po.packages_linked < po.packages_total && (
            <Link href={`/erp-upload?po=${po.id}`} className="inline-block text-sm font-medium text-brand-800 hover:underline">
              ERP 엑셀 다시 만들기 · 다른 차수 추가 →
            </Link>
          )}
        </CardContent>
      </Card>

      {/* 포장 = 작업의뢰서 */}
      {po.packages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              포장별 작업의뢰서 <span className="font-normal text-muted-foreground">— {po.packages_linked}/{po.packages_total} 도착</span>
            </CardTitle>
            <p className="text-sm text-muted-foreground">ERP 업로드 엑셀의 시트 한 장이 작업의뢰서 한 장이 됩니다. 도착하면 규격 · 수량을 대조합니다.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {sheets.map(sheet => (
              <div key={sheet} className="space-y-2">
                {sheets.length > 1 && <p className="text-sm font-semibold">{sheet || '차수 미지정'}</p>}
                {po.packages.filter(p => p.sheet_name === sheet).map(p => (
                  <PackageRow key={p.id} poId={po.id} pkg={p} canLink={canLink && !cancelled} />
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Timeline events={po.events} />
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3.5 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 font-semibold">{value}</div>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function NextStep({ title, text, href, action }: { title: string; text: string; href?: string; action?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-600/30 bg-brand-50/70 px-5 py-4">
      <div className="min-w-0">
        <p className="font-semibold text-brand-900">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{text}</p>
      </div>
      {href && action && (
        <Link href={href} className={buttonVariants({ size: 'lg' })}>{action}<ArrowRight /></Link>
      )}
    </div>
  );
}

function FileList({ title, poId, files }: { title: string; poId: string; files: PoFile[] }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <ul className="space-y-1.5">
        {files.map(f => (
          <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-brand-700" />
            <span className="min-w-0 flex-1 truncate font-medium">{f.file_name}</span>
            {f.sheet_name && <span className="text-xs text-muted-foreground">{f.sheet_name}</span>}
            <FileDownload poId={poId} file={f} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Timeline({ events }: { events: PoEvent[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" />이력</CardTitle></CardHeader>
      <CardContent>
        <ol className="space-y-2.5">
          {events.map(e => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="w-24 shrink-0 tabular text-muted-foreground">{when(e.created_at)}</span>
              <span className="w-20 shrink-0 truncate font-semibold">{e.user_name}</span>
              <span className="min-w-0">{(EVENT_TEXT[e.action] ?? (() => e.action))(e.detail)}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
