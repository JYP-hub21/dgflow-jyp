'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCheck, Loader2, Save, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import RemarkText from '@/components/production/RemarkText';
import QtyStepper from '@/components/production/QtyStepper';
import { blockTotals, itemNo, sizeText } from '@/lib/production/item-view';
import { deliveredByItem, deliveryTodo, groupDeliveries, type DeliveryLog } from '@/lib/production/delivery';
import { cn } from '@/lib/utils';

export interface DeliveryItem {
  id: string;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  produced_quantity: number;
  area_m2: number;
  remark: string | null;
  sort_order: number;
  item_no: number | null;
}

/**
 * 납품 입력 — 생산 입력과 같은 종이 양식에 납품 칸만 다르다 (2026-11-06 회의 "폼은 똑같으면 될 것 같아").
 * 일부만 나가거나 며칠에 나뉘어 나간다. 재고가 함께 나가 생산 수량을 넘을 수 있어 막지 않고 표시만 한다.
 */
export default function DeliveryPanel({ workOrderId, items, canEdit, defaultDate, onChanged }: {
  workOrderId: string;
  items: DeliveryItem[];
  canEdit: boolean;
  defaultDate: string;
  onChanged?: () => void;
}) {
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [storage, setStorage] = useState<'db' | 'none' | null>(null);
  const [date, setDate] = useState(defaultDate);
  const [note, setNote] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  /** 지우는 중인 기록 */
  const [removing, setRemoving] = useState<string | null>(null);

  /** 불러오기 실패 — 예전에는 연결이 끊기면 '불러오는 중…' 에서 멈췄다 (2026-11-10 점검) */
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deliveries?work_order_id=${workOrderId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = body.error ?? '납품 기록을 불러오지 못했습니다.';
        setLoadError(message);
        toast.error(message);
        return;
      }
      setLoadError(null);
      setLogs(body.logs ?? []);
      setStorage(body.storage);
    } catch {
      setLoadError('인터넷 연결이 끊겨 납품 기록을 불러오지 못했습니다.');
      toast.error('인터넷 연결이 끊겨 납품 기록을 불러오지 못했습니다.');
    }
  }, [workOrderId]);

  useEffect(() => { load(); }, [load]);

  const delivered = useMemo(() => deliveredByItem(logs), [logs]);
  const days = useMemo(() => groupDeliveries(logs), [logs]);
  const blocks = blockTotals(items);
  const blockStarts = new Map(blocks.map((b, k) => [k === 0 ? 0 : blocks[k - 1].endIndex + 1, b]));
  const itemById = useMemo(() => new Map(items.map((it, i) => [it.id, { ...it, no: itemNo(it, i) }])), [items]);

  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const totalProduced = items.reduce((s, i) => s + i.produced_quantity, 0);
  const totalDelivered = logs.reduce((s, l) => s + l.quantity, 0);
  // 미납은 품목마다 — 한 품목을 더 내보낸 것이 다른 품목의 미납을 메우지 않는다 (2026-11-10 점검)
  const totalRemaining = deliveryTodo(items, delivered).remaining;
  const totalInput = Object.values(quantities).reduce((s, v) => s + (parseInt(v) || 0), 0);
  const overProduced = items.filter(i => (delivered.get(i.id) ?? 0) + (parseInt(quantities[i.id]) || 0) > i.produced_quantity);
  const editable = canEdit && storage === 'db';

  const setQty = (id: string, v: string) => setQuantities(prev => ({ ...prev, [id]: v.replace(/[^0-9]/g, '') }));

  // 생산한 만큼 아직 안 나간 수량을 칸에만 채운다 — 확인하고 저장한다
  function fillProduced() {
    setQuantities(() => {
      const next: Record<string, string> = {};
      for (const i of items) {
        const left = i.produced_quantity - (delivered.get(i.id) ?? 0);
        if (left > 0) next[i.id] = String(left);
      }
      return next;
    });
  }

  async function save() {
    const list = Object.entries(quantities)
      .map(([work_order_item_id, v]) => ({ work_order_item_id, quantity: parseInt(v) || 0 }))
      .filter(i => i.quantity > 0);
    if (list.length === 0 || !date) return;
    setSaving(true);
    try {
      const res = await fetch('/api/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_order_id: workOrderId, delivery_date: date, note, items: list }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(body.error ?? '저장하지 못했습니다.'); return; }
      toast.success(`${date} 납품 ${totalInput}조를 저장했습니다.`);
      setQuantities({});
      setNote('');
      await load();
      onChanged?.();
    } catch {
      // 연결이 끊겼다 — 입력한 수량은 칸에 남겨 다시 누를 수 있게 한다 (2026-11-10 점검)
      toast.error('인터넷 연결이 끊겨 저장하지 못했습니다. 입력한 수량은 그대로 두었습니다 — 연결을 확인하고 다시 저장하세요.');
    } finally {
      setSaving(false);
    }
  }

  /** 지우기 전에 묻는다 — 생산 기록 지우기와 같다 (2026-11-10 점검) */
  async function remove(log: DeliveryLog) {
    const it = itemById.get(log.work_order_item_id);
    const name = it ? `No.${it.no} ${sizeText(it.width_mm, it.height_mm)}` : '이 기록';
    if (!confirm(`${log.delivery_date} ${name} 납품 ${log.quantity}조 기록을 삭제하시겠습니까?`)) return;
    setRemoving(log.id);
    try {
      const res = await fetch(`/api/deliveries/${log.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? '삭제하지 못했습니다.');
        return;
      }
      toast.success('납품 기록을 삭제했습니다.');
      await load();
      onChanged?.();
    } catch {
      toast.error('인터넷 연결이 끊겨 삭제하지 못했습니다. 연결을 확인하고 다시 시도하세요.');
    } finally {
      setRemoving(null);
    }
  }

  if (storage === null) {
    if (loadError) {
      return (
        <div className="flex flex-wrap items-center gap-3 p-5 text-sm">
          <span className="font-medium text-destructive">{loadError}</span>
          <Button variant="outline" size="sm" onClick={() => { setLoadError(null); load(); }}>다시 불러오기</Button>
        </div>
      );
    }
    return <p className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중…</p>;
  }

  return (
    <div>
      {storage === 'none' && (
        <p className="m-4 break-keep rounded-lg border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm">
          납품 기록을 저장할 표가 아직 데이터베이스에 없습니다. 표를 만들면 입력할 수 있습니다.
        </p>
      )}
      {/* 칸만 잠기면 고장처럼 보인다 — 왜 못 넣는지 알린다 (2026-11-12 사용자 "왜 안 돼?") */}
      {storage === 'db' && !canEdit && (
        <p className="m-4 break-keep rounded-lg border border-brand-600/30 bg-brand-50 px-4 py-2.5 text-sm font-medium text-brand-800">
          납품 입력은 생산관리부 · 생산부 계정에서 합니다. 이 계정에서는 납품 현황을 볼 수만 있습니다.
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3 border-b p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1.5">
            <span className="block text-[13px] font-semibold">납품일</span>
            <Input type="date" className="w-44" value={date} onChange={e => setDate(e.target.value)} disabled={!editable} />
          </label>
          <label className="space-y-1.5">
            <span className="block text-[13px] font-semibold">비고 <span className="font-normal text-muted-foreground">(선택)</span></span>
            <Input className="w-64" value={note} maxLength={200} onChange={e => setNote(e.target.value)} disabled={!editable}
              placeholder="부분 납품 사유 등" />
          </label>
        </div>
        <div className="tabular text-sm">
          의뢰 <b>{totalQty}</b> · 생산 <b>{totalProduced}</b> · 납품 <b className="text-brand-800">{totalDelivered}</b> · 미납 <b>{totalRemaining}</b>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="break-keep text-sm text-muted-foreground">
          납품일은 현장에 들어가는 날짜 기준으로 입력하세요. 재고가 함께 나가 생산 수량을 넘을 때는 표시만 되고 저장할 수 있습니다.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={fillProduced} disabled={!editable}><CheckCheck />생산분 전량 입력</Button>
          <Button onClick={save} disabled={!editable || saving || totalInput === 0 || !date}>
            <Save />{saving ? '저장 중…' : `납품 저장${totalInput > 0 ? ` (${totalInput}조)` : ''}`}
          </Button>
        </div>
      </div>

      {overProduced.length > 0 && totalInput > 0 && (
        <p className="flex items-center gap-1.5 border-b bg-warning-50 px-4 py-2 text-sm font-medium text-warning">
          <TriangleAlert className="h-4 w-4 shrink-0" />생산 수량을 넘는 품목이 {overProduced.length}건 있습니다. 재고분이 아니면 수량을 확인하세요.
        </p>
      )}

      <div className="overflow-x-auto">
        <Table className="min-w-[900px] [&_td+td]:border-l [&_th+th]:border-l">
          <TableHeader>
            <TableRow>
              <TableHead colSpan={6} className="h-8 text-center text-xs font-semibold text-muted-foreground">작업의뢰서</TableHead>
              <TableHead colSpan={4} className="h-8 bg-brand-50 text-center text-xs font-semibold text-brand-800">납품</TableHead>
            </TableRow>
            <TableRow>
              <TableHead className="w-12 text-center">No</TableHead>
              <TableHead className="w-[210px] text-center">품명</TableHead>
              <TableHead className="w-32 text-center">규격</TableHead>
              <TableHead className="w-14 text-center">수량</TableHead>
              <TableHead className="w-16 text-center">면적(M²)</TableHead>
              <TableHead className="text-center">비고</TableHead>
              <TableHead className="w-14 bg-brand-50 text-center">생산</TableHead>
              <TableHead className="w-14 bg-brand-50 text-center">납품</TableHead>
              <TableHead className="w-14 bg-brand-50 text-center">미납</TableHead>
              <TableHead className="w-32 bg-brand-50 text-center">납품 입력</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, idx) => {
              const done = delivered.get(item.id) ?? 0;
              const typed = parseInt(quantities[item.id]) || 0;
              const over = done + typed > item.produced_quantity;
              return (
                <TableRow key={item.id}>
                  <TableCell className="tabular text-center font-semibold">{itemNo(item, idx)}</TableCell>
                  <TableCell className="max-w-[240px] whitespace-normal break-keep text-[13px] font-semibold leading-snug">{blockStarts.get(idx) ? item.product_name : ''}</TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right">{sizeText(item.width_mm, item.height_mm)}</TableCell>
                  <TableCell className="tabular text-right">{item.quantity}</TableCell>
                  <TableCell className="tabular text-right">{Number(item.area_m2 || 0).toFixed(2)}</TableCell>
                  <TableCell className="whitespace-normal"><RemarkText text={item.remark} /></TableCell>
                  <TableCell className="tabular text-right">{item.produced_quantity}</TableCell>
                  <TableCell className="tabular text-right">{done}</TableCell>
                  <TableCell className="tabular text-right font-semibold">{Math.max(0, item.quantity - done)}</TableCell>
                  <TableCell>
                    {/* 생산 입력과 같은 칸 — 옆의 작은 + · − 로 한 조씩 (2026-11-12 사용자 "생산입력이랑 똑같이") */}
                    <QtyStepper size="sm" label={`No.${itemNo(item, idx)} 납품 수량`} value={quantities[item.id] ?? ''} disabled={!editable}
                      onChange={v => setQty(item.id, v)} highlight={typed > 0 && !over}
                      inputClassName={cn(typed > 0 && over && 'border-warning bg-warning-50')} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="p-4">
        <h4 className="mb-2 text-[15px] font-bold">날짜별 납품 <span className="font-normal text-muted-foreground">{days.length}일</span></h4>
        {days.length === 0 ? (
          <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">납품 기록이 없습니다.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {days.map(day => (
              <div key={day.date} className="px-3.5 py-2.5 text-sm">
                <p className="tabular font-semibold">{day.date} <span className="ml-2 text-brand-800">{day.quantity}조</span> <span className="ml-1 font-normal text-muted-foreground">{day.area_m2.toFixed(2)}M²</span></p>
                <ul className="mt-1 space-y-0.5 text-[13px] text-muted-foreground">
                  {day.logs.map(l => {
                    const it = itemById.get(l.work_order_item_id);
                    return (
                      <Fragment key={l.id}>
                        <li className="tabular flex items-center gap-2">
                          <span>No.{it?.no ?? '-'} {it ? sizeText(it.width_mm, it.height_mm) : ''} · {l.quantity}조{l.note ? ` · ${l.note}` : ''}</span>
                          {canEdit && (
                            <button type="button" aria-label="납품 기록 삭제" title="삭제" onClick={() => remove(l)} disabled={removing !== null}
                              className="text-muted-foreground hover:text-destructive disabled:opacity-40">
                              {removing === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </li>
                      </Fragment>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
