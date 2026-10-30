'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, ChevronUp, Check, Pencil } from 'lucide-react';
import QtyStepper from './QtyStepper';
import { formatDays, itemNo, type DayQty } from '@/lib/production/item-view';

/**
 * 폰에서 쓰는 생산실적 입력.
 *
 * PC 는 6열 표(품명·규격·의뢰·완료·잔여·입력)로 두고, 폰에서는 품목당 카드 한 장으로 바꾼다.
 * 표를 그대로 두면 가로로 밀려서 **입력칸을 누르는 순간 품명과 잔여가 화면 밖으로 나간다** —
 * 몇 장을 만들었는지 적는 화면에서 그게 제일 치명적이다.
 *
 * 공장에서 장갑 낀 손으로 쓰므로 입력칸과 버튼은 48px 이상으로 둔다.
 * 숫자만 치니 `inputMode="numeric"` 으로 폰이 숫자 키패드를 띄우게 한다.
 *
 * 다 만든 품목은 맨 아래로 접어 둔다. 하루가 갈수록 남은 일만 위에 보여 리스트가 짧아진다.
 * 접어도 순서가 바뀌어 보이지 않게 카드마다 작업의뢰서 품목 번호(No.)를 단다 — 종이와 번호로 맞춘다 (2026-10-30 피드백).
 */

export interface CardItem {
  id: string;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  produced_quantity: number;
  remark?: string | null;
  sort_order?: number;
}

interface Props {
  items: CardItem[];
  quantities: Record<string, string>;
  onChange: (itemId: string, value: string) => void;
  /** 품목의 저장된 기록 — "수정" 을 누르면 카드 안에 펼친다 */
  renderLogs: (itemId: string) => ReactNode;
  /** 품목별 생산 날짜 · 수량 */
  daysByItem?: Map<string, DayQty[]>;
}

export default function ProductionCards({ items, quantities, onChange, renderLogs, daysByItem }: Props) {
  const [showDone, setShowDone] = useState(false);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const toggleEdit = (id: string) => setEditItemId((cur) => (cur === id ? null : id));

  const remainingOf = (i: CardItem) => i.quantity - i.produced_quantity;
  const todo = items.filter((i) => remainingOf(i) > 0);
  const done = items.filter((i) => remainingOf(i) <= 0);

  return (
    <div className="space-y-2">
      {todo.map((item) => (
        <ItemCard key={item.id} item={item} no={itemNo(item, items.indexOf(item))} remaining={remainingOf(item)}
          value={quantities[item.id] ?? ''} onChange={onChange} days={daysByItem?.get(item.id) ?? []}
          editing={editItemId === item.id} onToggleEdit={() => toggleEdit(item.id)}
          logs={editItemId === item.id && renderLogs(item.id)} />
      ))}

      {todo.length === 0 && (
        <div className="rounded-xl border border-success/30 bg-success-50 px-4 py-6 text-center">
          <Check className="mx-auto h-6 w-6 text-success" />
          <div className="mt-1 font-semibold">모두 생산했습니다</div>
        </div>
      )}

      {done.length > 0 && (
        <div className="rounded-xl border bg-muted/40">
          <button type="button" onClick={() => setShowDone((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium">
            {showDone ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            완료 {done.length}건
            <span className="text-muted-foreground font-normal">
              {showDone ? '' : '— 눌러서 확인'}
            </span>
          </button>
          {showDone && (
            <div className="space-y-2 px-2 pb-2">
              {done.map((item) => (
                <div key={item.id}
                  className="overflow-hidden rounded-lg border border-success/20 bg-success-50 text-sm">
                  <div className="px-3 py-2.5">
                    <div className="truncate font-medium">
                      <span className="mr-1.5 text-muted-foreground">No.{itemNo(item, items.indexOf(item))}</span>{item.product_name}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-muted-foreground">
                      <span>{item.width_mm}×{item.height_mm}</span>
                      <span className="ml-auto flex items-center gap-1 font-semibold text-success">
                        <Check className="h-4 w-4" /> {item.quantity}장 완료
                      </span>
                      <EditToggle editing={editItemId === item.id} onClick={() => toggleEdit(item.id)} />
                    </div>
                  </div>
                  {editItemId === item.id && <div className="border-t bg-card">{renderLogs(item.id)}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditToggle({ editing, onClick }: { editing: boolean; onClick: () => void }) {
  return (
    <Button variant={editing ? 'secondary' : 'outline'} onClick={onClick} className="h-10 shrink-0 px-3">
      {editing ? <ChevronUp /> : <Pencil />}수정
    </Button>
  );
}

function ItemCard({ item, no, remaining, value, onChange, days, editing, onToggleEdit, logs }: {
  item: CardItem; no: number; remaining: number; value: string;
  onChange: (itemId: string, value: string) => void;
  days: DayQty[];
  editing: boolean; onToggleEdit: () => void; logs: ReactNode;
}) {
  const entered = parseInt(value) || 0;
  const over = entered > remaining;

  return (
    <div className={`rounded-xl border bg-card px-4 py-3.5 shadow-xs ${over ? 'border-destructive' : entered > 0 ? 'border-brand-600 bg-brand-50/60' : ''}`}>
      <div className="font-semibold leading-snug">
        <span className="mr-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-bold text-muted-foreground">No.{no}</span>
        {item.product_name}
      </div>
      {item.remark && <div className="mt-1 break-all text-xs text-muted-foreground">{item.remark}</div>}
      <div className="mt-0.5 text-sm text-muted-foreground tabular-nums">
        {item.width_mm}×{item.height_mm} · 의뢰 {item.quantity} · 완료 {item.produced_quantity}
      </div>
      {days.length > 0 && <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">생산 {formatDays(days)}</div>}

      <div className="mt-3 flex items-center gap-2">
        <div className="shrink-0 tabular-nums">
          <span className="text-sm text-muted-foreground">잔여 </span>
          <span className="text-xl font-bold">{remaining}</span>
        </div>
        <div className="ml-auto">
          <QtyStepper size="lg" value={value} onChange={(v) => onChange(item.id, v)} invalid={over} highlight={entered > 0} />
        </div>
        <Button variant="outline" onClick={() => onChange(item.id, String(remaining))}
          className="h-12 px-4 shrink-0">
          전량
        </Button>
      </div>

      {over && (
        <div className="mt-2 text-sm font-medium text-destructive">
          잔여 {remaining}장보다 많습니다.
        </div>
      )}

      {item.produced_quantity > 0 && (
        <div className="mt-2 flex justify-end">
          <EditToggle editing={editing} onClick={onToggleEdit} />
        </div>
      )}
      {editing && <div className="-mx-4 -mb-3.5 mt-3 border-t">{logs}</div>}
    </div>
  );
}
