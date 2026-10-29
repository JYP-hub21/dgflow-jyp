'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import NativeSelect from '@/components/ui/native-select';
import { Pencil, Trash2, Check, X } from 'lucide-react';

/**
 * 저장한 생산 기록 — 날짜별로 묶고, 기록 한 줄마다 고치거나 지운다.
 * 품목 행의 "수정" 을 누르면 그 품목의 기록만 행 바로 아래에 펼쳐 보인다.
 *
 * 잘못 친 수량을 되돌릴 방법이 없으면 사원은 "빼기" 를 할 수 없어 틀린 채로 둔다.
 * 품목의 완료 수량은 서버가 기록의 합으로 다시 맞추므로 여기서는 기록만 고친다.
 * PC·폰 모두 같은 목록을 쓴다 — 표로 두면 폰에서 수정 칸이 화면 밖으로 밀린다.
 */

export interface ProductionLog {
  id: string;
  work_order_item_id: string | null;
  production_date: string;
  quantity_completed: number;
  area_m2: number | null;
  shift: 'day' | 'night' | null;
  line_number: number | null;
  item: { product_name: string; width_mm: number; height_mm: number; quantity: number } | null;
}

interface Draft { qty: string; date: string; shift: 'day' | 'night'; line: string }

interface Props {
  logs: ProductionLog[];
  /** 기록을 고치거나 지운 뒤 품목·기록을 다시 읽는다 */
  onChanged: () => Promise<void>;
  /** 품목 행 아래에 펼칠 때는 품명·합계를 다시 쓰지 않는다 */
  compact?: boolean;
  /** 아래쪽 전체 기록은 보기만 한다 — 고치는 곳은 품목 행 하나로 둔다 */
  readOnly?: boolean;
}

export default function ProductionLogList({ logs, onChanged, compact, readOnly }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byDate = new Map<string, ProductionLog[]>();
  for (const log of logs) byDate.set(log.production_date, [...(byDate.get(log.production_date) || []), log]);

  function startEdit(log: ProductionLog) {
    setEditingId(log.id);
    setError(null);
    setDraft({
      qty: String(log.quantity_completed),
      date: log.production_date,
      shift: log.shift === 'night' ? 'night' : 'day',
      line: String(log.line_number || 1),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setError(null);
  }

  async function saveEdit(id: string) {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/production/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quantity_completed: parseInt(draft.qty),
        production_date: draft.date,
        shift: draft.shift,
        line_number: parseInt(draft.line),
      }),
    });
    if (res.ok) {
      await onChanged();
      cancelEdit();
    } else {
      setError((await res.json().catch(() => null))?.error || '저장하지 못했습니다');
    }
    setBusy(false);
  }

  async function remove(log: ProductionLog) {
    const name = log.item ? `${log.item.product_name} ${log.item.width_mm}×${log.item.height_mm}` : '이 기록';
    if (!confirm(`${log.production_date} ${name} ${log.quantity_completed}장 기록을 삭제할까요?`)) return;
    setBusy(true);
    const res = await fetch(`/api/production/${log.id}`, { method: 'DELETE' });
    if (res.ok) {
      await onChanged();
      if (editingId === log.id) cancelEdit();
    } else {
      alert((await res.json().catch(() => null))?.error || '삭제하지 못했습니다');
    }
    setBusy(false);
  }

  const grandQty = logs.reduce((s, l) => s + l.quantity_completed, 0);
  const grandArea = logs.reduce((s, l) => s + Number(l.area_m2 || 0), 0);

  return (
    <div>
      {[...byDate.entries()].map(([date, dayLogs]) => {
        const dayQty = dayLogs.reduce((s, l) => s + l.quantity_completed, 0);
        const dayArea = dayLogs.reduce((s, l) => s + Number(l.area_m2 || 0), 0);
        return (
          <div key={date} className="border-b last:border-b-0">
            <div className={cn('flex items-center justify-between bg-muted/60 px-5 text-sm', compact ? 'py-1.5' : 'py-2')}>
              <span className="tabular font-bold">{date}</span>
              <span className="tabular text-muted-foreground">
                <b className="text-foreground">{dayQty}</b>장 · {dayArea.toFixed(2)}m²
              </span>
            </div>
            <ul className="divide-y">
              {dayLogs.map(log => {
                const editing = editingId === log.id && draft;
                return (
                  <li key={log.id} className={cn('px-5 py-3', editing && 'bg-brand-50/60')}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1">
                        {!compact && <p className="truncate font-semibold">{log.item?.product_name ?? '(품목 없음)'}</p>}
                        <p className="tabular text-sm text-muted-foreground">
                          {!compact && log.item && `${log.item.width_mm} × ${log.item.height_mm} · `}
                          {log.shift === 'night' ? '야간' : '주간'} {log.line_number || 1}호기
                        </p>
                      </div>
                      {!editing && (
                        <>
                          <span className="tabular text-lg font-bold">{log.quantity_completed}<span className="ml-0.5 text-sm font-medium text-muted-foreground">장</span></span>
                          {!readOnly && <div className="flex gap-1.5">
                            <Button variant="outline" size="sm" onClick={() => startEdit(log)} disabled={busy}>
                              <Pencil />수정
                            </Button>
                            <Button variant="destructive" size="icon-sm" onClick={() => remove(log)} disabled={busy} aria-label="삭제">
                              <Trash2 />
                            </Button>
                          </div>}
                        </>
                      )}
                    </div>

                    {editing && (
                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        <label className="space-y-1">
                          <span className="block text-xs font-semibold text-muted-foreground">수량</span>
                          <Input inputMode="numeric" value={draft.qty} autoFocus
                            onChange={e => setDraft({ ...draft, qty: e.target.value.replace(/[^0-9]/g, '') })}
                            className="h-11 w-24 text-right text-base font-semibold tabular" />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-xs font-semibold text-muted-foreground">생산일자</span>
                          <Input type="date" value={draft.date} className="h-11 w-40"
                            onChange={e => setDraft({ ...draft, date: e.target.value })} />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-xs font-semibold text-muted-foreground">주 / 야간</span>
                          <NativeSelect value={draft.shift} className="h-11 w-24"
                            onChange={e => setDraft({ ...draft, shift: e.target.value as 'day' | 'night' })}>
                            <option value="day">주간</option>
                            <option value="night">야간</option>
                          </NativeSelect>
                        </label>
                        <label className="space-y-1">
                          <span className="block text-xs font-semibold text-muted-foreground">호기</span>
                          <NativeSelect value={draft.line} className="h-11 w-24"
                            onChange={e => setDraft({ ...draft, line: e.target.value })}>
                            <option value="1">1호기</option>
                            <option value="2">2호기</option>
                          </NativeSelect>
                        </label>
                        <div className="flex gap-1.5">
                          <Button className="h-11" onClick={() => saveEdit(log.id)}
                            disabled={busy || !(parseInt(draft.qty) > 0)}>
                            <Check />저장
                          </Button>
                          <Button variant="outline" className="h-11" onClick={cancelEdit} disabled={busy}>
                            <X />취소
                          </Button>
                        </div>
                        {error && <p className="w-full text-sm font-medium text-destructive">{error}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {logs.length === 0 && <p className="px-5 py-3 text-sm text-muted-foreground">저장한 기록이 없습니다</p>}
      {!compact && (
        <div className="flex items-center justify-between bg-muted px-5 py-3 font-bold">
          <span>합계</span>
          <span className="tabular">{grandQty}장 · {grandArea.toFixed(2)}m²</span>
        </div>
      )}
    </div>
  );
}
