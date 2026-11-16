'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { sizeText } from '@/lib/production/item-view';

export interface MesQtyItem { id: string; no: number; product_name: string; width_mm: number; height_mm: number; quantity: number }

/**
 * MES 로 만든 작업의뢰서의 품목 수량 수정 (2026-11-16). 의뢰 수량과 생산 수량이 함께 바뀐다 —
 * 서버 PATCH /api/work-orders/[id]/quantities (lib/production/mes-quantity.ts).
 */
export default function MesQuantityDialog({ workOrderId, number, items }: { workOrderId: string; number: string; items: MesQtyItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');

  const changed = useMemo(() => items.filter(i => values[i.id] !== undefined && values[i.id] !== '' && Number(values[i.id]) !== i.quantity), [items, values]);
  const invalid = items.some(i => values[i.id] !== undefined && values[i.id] !== '' && !(Number(values[i.id]) >= 1));
  const shown = filter.trim()
    ? items.filter(i => `${i.no} ${i.product_name} ${i.width_mm} ${i.height_mm}`.includes(filter.trim()))
    : items;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/quantities`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: changed.map(i => ({ id: i.id, quantity: Number(values[i.id]) })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(body.error ?? '수량을 저장하지 못했습니다.'); return; }
      toast.success(`품목 ${body.changed}건의 수량을 수정했습니다.`);
      setOpen(false);
      setValues({});
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setValues({}); setFilter(''); setOpen(true); }}>
        <Pencil />수량 수정
      </Button>
      {open && (
        <Dialog open onOpenChange={o => { if (!o && !busy) setOpen(false); }}>
          <DialogContent className="gap-4 p-6 sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">작업의뢰서 {number} 수량 수정</DialogTitle>
              <DialogDescription>
                MES 바코드로 센 수량입니다. 실제 수량과 다르면 고치세요. 의뢰 수량과 생산 수량이 함께 바뀌며,
                늘린 수량은 그 품목의 마지막 생산일에, 줄인 수량은 마지막 생산일부터 뺍니다.
              </DialogDescription>
            </DialogHeader>
            {items.length > 12 && (
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="No · 품명 · 규격 검색"
                className="h-10 rounded-md border border-input px-3 text-sm" />
            )}
            <div className="max-h-[55vh] overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="w-12 py-2 text-center font-semibold">No</th>
                    <th className="py-2 text-left font-semibold">품명 · 규격</th>
                    <th className="w-20 py-2 text-right font-semibold">현재</th>
                    <th className="w-28 py-2 pr-3 text-right font-semibold">수정 수량</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map(i => {
                    const v = values[i.id] ?? '';
                    const diff = v !== '' && Number(v) !== i.quantity;
                    return (
                      <tr key={i.id} className={diff ? 'bg-brand-50/60' : ''}>
                        <td className="tabular py-1.5 text-center font-semibold">{i.no}</td>
                        <td className="py-1.5">
                          <p className="break-keep text-[13px] leading-snug">{i.product_name}</p>
                          <p className="tabular text-xs text-muted-foreground">{sizeText(i.width_mm, i.height_mm)}</p>
                        </td>
                        <td className="tabular py-1.5 text-right">{i.quantity}</td>
                        <td className="py-1.5 pr-3 text-right">
                          <input inputMode="numeric" aria-label={`No.${i.no} 수정 수량`} value={v} placeholder={String(i.quantity)}
                            onChange={e => setValues(prev => ({ ...prev, [i.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                            className="tabular h-9 w-20 rounded-md border border-input px-2 text-right" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DialogFooter className="-mx-6 -mb-6 items-center px-6">
              <p className="mr-auto text-sm text-muted-foreground">{invalid ? '수량은 1 이상이어야 합니다.' : `바뀐 품목 ${changed.length}건`}</p>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>취소</Button>
              <Button type="button" onClick={save} disabled={busy || invalid || changed.length === 0}>{busy ? '저장 중…' : '저장'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
