import { Factory, Phone, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { telHref, type WorkOrderSite } from '@/lib/work-order/site';

/**
 * 생산 공장 표시 — "오창공장" 또는 "외주 · 업체". withContact 면 외주 담당자와 전화(누르면 전화 걸기)까지.
 * 서버 · 클라이언트 어디서나 쓴다 (훅 없음).
 */
export default function SiteBadge({ value, withContact = false, className }: {
  value: WorkOrderSite; withContact?: boolean; className?: string;
}) {
  if (value.site === 'ochang') {
    return (
      <span className={cn('inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800', className)}>
        <Factory className="h-3.5 w-3.5" />오창공장
      </span>
    );
  }
  const p = value.partner;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', className)}>
      <span className="inline-flex items-center gap-1 rounded-md border border-warning/50 bg-warning-50 px-2 py-0.5 font-semibold text-foreground">
        <Truck className="h-3.5 w-3.5 text-warning" />외주{p ? ` · ${p.name}` : ' (업체 미정)'}
      </span>
      {withContact && p && (p.contact_name || p.phone) && (
        <span className="inline-flex items-center gap-1.5">
          {p.contact_name && <span className="font-medium">{p.contact_name}</span>}
          {p.phone && (
            <a href={telHref(p.phone)} className="inline-flex items-center gap-1 font-semibold text-brand-800 hover:underline">
              <Phone className="h-3 w-3" />{p.phone}
            </a>
          )}
        </span>
      )}
    </span>
  );
}
