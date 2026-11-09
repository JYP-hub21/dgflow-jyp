import { Fragment } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { Factory, CheckCircle, Phone } from 'lucide-react';
import type { SiteContact } from '@/lib/production/contacts';
import { telHref } from '@/lib/work-order/site';
import { daysBetweenDates, itemNo } from '@/lib/production/item-view';

/**
 * 아직 다 만들지 않은 품목만 모아 본다.
 *
 * 작업의뢰서 목록은 "어느 의뢰서가 몇 % 됐나" 를 보여 주지만, 공장에서 알고 싶은 것은
 * "지금 무엇을 몇 장 더 만들어야 하나" 다. 의뢰서별로 묶되 다 만든 품목은 빼고,
 * 납기가 가까운 의뢰서부터 둔다.
 */

export interface RemainingItem {
  id: string;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  produced_quantity: number;
  /** 작업의뢰서 품목 번호 — 종이의 NO(item_no), 없으면 sort_order + 1. 남은 것만 보여도 종이와 번호로 맞춘다 */
  sort_order?: number;
  item_no?: number | null;
  remark?: string | null;
}

export interface RemainingGroup {
  id: string;
  work_order_number: string;
  delivery_date: string | null;
  customer: string | null;
  site: string | null;
  items: RemainingItem[];
  /** 이 의뢰서를 마지막으로 생산한 날 (없으면 아직 안 함) */
  last_produced?: string | null;
  /** 발주서 올린 사람(공사관리부) — 물어볼 사람 */
  contact?: SiteContact | null;
}

/** 이 날 수가 지나도록 손대지 않은 의뢰서는 눈에 띄게 (회의: "못 만들면 한 달까지 밀린다") */
const STALE_DAYS = 14;

export default function RemainingItems({ groups, today }: { groups: RemainingGroup[]; today: string }) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card py-10 text-center">
        <CheckCircle className="h-6 w-6 text-success" />
        <p className="font-semibold">남은 품목이 없습니다</p>
        <p className="text-sm text-muted-foreground">진행 중인 작업의뢰서를 모두 생산했습니다.</p>
      </div>
    );
  }

  const all = groups.flatMap(g => g.items);
  const remainingQty = all.reduce((s, i) => s + i.quantity - i.produced_quantity, 0);
  const remainingArea = all.reduce((s, i) => s + i.width_mm * i.height_mm * (i.quantity - i.produced_quantity) / 1_000_000, 0);
  const untouched = all.filter(i => i.produced_quantity === 0).length;

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="작업의뢰서" value={groups.length} unit="건" />
          <Stat label="남은 품목" value={all.length} unit="건" />
          <Stat label="남은 수량" value={remainingQty} unit="조" strong />
          <Stat label="남은 면적" value={remainingArea.toFixed(2)} unit="M²" />
        </CardContent>
      </Card>
      {untouched > 0 && (
        <p className="text-sm text-muted-foreground">
          그중 <b className="text-foreground">{untouched}건</b>은 아직 한 장도 만들지 않았습니다 (<span className="font-semibold text-warning">미착수</span> 표시).
        </p>
      )}

      {groups.map(g => {
        const groupQty = g.items.reduce((s, i) => s + i.quantity - i.produced_quantity, 0);
        const overdue = g.delivery_date && g.delivery_date < today;
        const idle = g.last_produced ? daysBetweenDates(g.last_produced, today) : null;
        return (
          <Card key={g.id} className="gap-0 py-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/50 px-5 py-3">
              <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                <Link href={`/work-orders/${g.id}`} className="font-bold text-brand-800 hover:underline">
                  {g.work_order_number}
                </Link>
                <span className="ml-2 font-medium">{g.customer ?? ''}</span>
                <p className="truncate text-sm text-muted-foreground">
                  {g.site ?? '-'}
                  {g.contact && (
                    <span> · 공사 담당 {g.contact.name}
                      {g.contact.phone && (
                        <a href={telHref(g.contact.phone)} className="ml-1 inline-flex items-center gap-0.5 font-semibold text-brand-800 hover:underline">
                          <Phone className="h-3 w-3" />{g.contact.phone}
                        </a>
                      )}
                    </span>
                  )}
                </p>
              </div>
              <span className={cn('tabular text-sm', idle != null && idle >= STALE_DAYS ? 'font-semibold text-warning' : 'text-muted-foreground')}>
                {g.last_produced
                  ? `마지막 생산 ${g.last_produced.slice(5).replace('-', '/')}${idle === 0 ? ' · 오늘' : idle != null && idle > 0 ? ` · ${idle}일 전` : ''}`
                  : '생산 이력 없음'}
              </span>
              {g.delivery_date && (
                <span className={cn('tabular text-sm', overdue ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                  납기 {g.delivery_date}{overdue && ' (지남)'}
                </span>
              )}
              <span className="tabular text-sm">남은 <b className="text-base">{groupQty}</b>조</span>
              <Link href={`/production/${g.id}`} className={buttonVariants({ size: 'sm', className: 'w-full sm:w-auto' })}>
                <Factory />생산 입력
              </Link>
            </div>
            <ul className="divide-y">
              {g.items.map((item, i) => {
                const remaining = item.quantity - item.produced_quantity;
                // 품명이 바뀌는 곳에만 머리줄 — 같은 품명을 줄마다 되풀이하지 않는다
                const newBlock = i === 0 || g.items[i - 1].product_name !== item.product_name;
                let end = i;
                while (newBlock && end + 1 < g.items.length && g.items[end + 1].product_name === item.product_name) end++;
                const blockItems = newBlock ? g.items.slice(i, end + 1) : [];
                return (
                  <Fragment key={item.id}>
                  {newBlock && (
                    <li className="flex items-center justify-between gap-3 bg-muted/60 px-5 py-1.5 text-xs">
                      <span className="min-w-0 truncate font-bold text-foreground">{item.product_name}</span>
                      <span className="tabular shrink-0 text-muted-foreground">
                        {blockItems.length}품목 · 남음 {blockItems.reduce((s, x) => s + x.quantity - x.produced_quantity, 0)}조
                      </span>
                    </li>
                  )}
                  <li className="flex items-center gap-3 px-5 py-2.5">
                    <span className="tabular w-9 shrink-0 text-center text-sm font-bold text-muted-foreground">{itemNo(item)}</span>
                    <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-5">
                      <div className="sm:w-44 sm:shrink-0">
                        <p className="tabular font-semibold">{item.width_mm} × {item.height_mm}</p>
                        <p className="tabular text-sm text-muted-foreground">의뢰 {item.quantity} · 완료 {item.produced_quantity}</p>
                      </div>
                      {/* 비고(유리 위치) — 종이처럼 규격 · 수량 다음 */}
                      <p title={item.remark ?? ''} className="mt-0.5 line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug text-foreground/80 break-keep [overflow-wrap:anywhere] sm:mt-0">
                        {item.remark ? <><span className="mr-1 text-xs font-semibold text-muted-foreground sm:hidden">비고</span>{item.remark}</> : <span className="text-muted-foreground">-</span>}
                      </p>
                    </div>
                    {item.produced_quantity === 0 && (
                      <span className="shrink-0 rounded-md bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">미착수</span>
                    )}
                    <span className="tabular w-14 shrink-0 text-right text-lg font-bold">
                      {remaining}<span className="ml-0.5 text-sm font-medium text-muted-foreground">조</span>
                    </span>
                  </li>
                  </Fragment>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function Stat({ label, value, unit, strong }: { label: string; value: number | string; unit: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={cn('tabular mt-0.5 text-xl font-bold', strong ? 'text-brand-800' : 'text-foreground')}>
        {value}<span className="ml-0.5 text-sm font-medium text-muted-foreground">{unit}</span>
      </p>
    </div>
  );
}
