'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { sizeText } from '@/lib/production/item-view';
import { activeLines } from '@/lib/production/lines';
import { useProductionLines } from '@/components/production/useProductionLines';

export interface MesItem { id: string; no: number; product_name: string; width_mm: number; height_mm: number; quantity: number }
interface SpecDraft { name: string; w: string; h: string }
interface AddDraft { key: number; no: string; name: string; w: string; h: string; qty: string; date: string; line: number }

const digits = (s: string) => s.replace(/[^0-9]/g, '');
const input = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

/**
 * MES 로 만든 작업의뢰서의 품목 수정 (2026-11-16) — 수량 · 품명 · 규격 고치기, 빠진 품목 더하기, 잘못 들어간 품목 지우기.
 * 서버 PATCH /api/work-orders/[id]/items (lib/production/mes-items.ts). 수량을 고치면 생산 기록도 함께 바뀐다.
 */
export default function MesItemsDialog({ workOrderId, number, items, missingNos, lastProduced, defaultLine }: {
  workOrderId: string; number: string; items: MesItem[];
  /** MES 에 한 장도 안 찍혀 품목이 없는 번호 — '더하기' 를 바로 누를 수 있게 */
  missingNos: number[];
  /** 이 의뢰서의 마지막 생산일 · 가장 많이 만든 호기 — 더하는 품목의 생산일 · 호기 기본값 */
  lastProduced: string | null; defaultLine: number;
}) {
  const router = useRouter();
  const { lines } = useProductionLines();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [spec, setSpec] = useState<Record<string, SpecDraft>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [adds, setAdds] = useState<AddDraft[]>([]);
  const [filter, setFilter] = useState('');
  const [seq, setSeq] = useState(1);

  const reset = () => { setQty({}); setSpec({}); setRemoved(new Set()); setAdds([]); setFilter(''); };
  const names = useMemo(() => [...new Set(items.map(i => i.product_name))], [items]);
  const usedNos = useMemo(() => new Set([...items.filter(i => !removed.has(i.id)).map(i => i.no), ...adds.map(a => Number(a.no)).filter(n => n > 0)]), [items, removed, adds]);
  const openMissing = missingNos.filter(n => !usedNos.has(n));

  /** 새 품목 줄 — 번호는 빠진 번호부터, 품명은 그 번호와 가장 가까운 품목 것을 미리 넣는다 */
  function addRow(no?: number) {
    const next = no ?? openMissing[0] ?? Math.max(0, ...items.map(i => i.no), ...adds.map(a => Number(a.no) || 0)) + 1;
    const near = [...items].sort((a, b) => Math.abs(a.no - next) - Math.abs(b.no - next))[0];
    setAdds(prev => [...prev, { key: seq, no: String(next), name: near?.product_name ?? '', w: '', h: '', qty: '', date: lastProduced ?? '', line: defaultLine }]);
    setSeq(seq + 1);
  }
  const patchAdd = (key: number, p: Partial<AddDraft>) => setAdds(prev => prev.map(a => a.key === key ? { ...a, ...p } : a));

  // 보낼 내용 · 틀린 곳
  const update = items.filter(i => !removed.has(i.id)).flatMap(i => {
    const u: { id: string; quantity?: number; product_name?: string; width_mm?: number; height_mm?: number } = { id: i.id };
    const q = qty[i.id];
    if (q !== undefined && q !== '' && Number(q) !== i.quantity) u.quantity = Number(q);
    const s = spec[i.id];
    if (s) {
      if (s.name.trim() !== i.product_name) u.product_name = s.name.trim();
      if (Number(s.w) !== i.width_mm) u.width_mm = Number(s.w);
      if (Number(s.h) !== i.height_mm) u.height_mm = Number(s.h);
    }
    return Object.keys(u).length > 1 ? [u] : [];
  });
  const problem = (() => {
    for (const i of items) {
      if (removed.has(i.id)) continue;
      const q = qty[i.id];
      if (q !== undefined && q !== '' && !(Number(q) >= 1)) return `No.${i.no} 수량은 1 이상이어야 합니다.`;
      const s = spec[i.id];
      if (s && (!s.name.trim() || !(Number(s.w) >= 1) || !(Number(s.h) >= 1))) return `No.${i.no} 품명 · 가로 · 세로를 채우세요.`;
    }
    const seen = new Set(items.filter(i => !removed.has(i.id)).map(i => i.no));
    for (const a of adds) {
      const no = Number(a.no);
      if (!(no >= 1)) return '더할 품목의 No 를 입력하세요.';
      if (seen.has(no)) return `No.${no} 은(는) 이미 있습니다.`;
      seen.add(no);
      if (!a.name.trim()) return `No.${no} 품명을 입력하세요.`;
      if (!(Number(a.w) >= 1) || !(Number(a.h) >= 1)) return `No.${no} 가로 · 세로를 입력하세요.`;
      if (!(Number(a.qty) >= 1)) return `No.${no} 수량을 입력하세요.`;
    }
    if (items.length - removed.size + adds.length < 1) return '품목을 전부 지울 수는 없습니다.';
    return '';
  })();
  const changes = update.length + adds.length + removed.size;
  const summary = [update.length && `수정 ${update.length}건`, adds.length && `추가 ${adds.length}건`, removed.size && `삭제 ${removed.size}건`].filter(Boolean).join(' · ');

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/items`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          update,
          add: adds.map(a => ({ item_no: Number(a.no), product_name: a.name.trim(), width_mm: Number(a.w), height_mm: Number(a.h), quantity: Number(a.qty), produced_date: a.date || null, line_number: a.line })),
          remove: [...removed],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(body.error ?? '품목을 저장하지 못했습니다.'); return; }
      toast.success(`품목을 고쳤습니다 — ${summary}`);
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      toast.error('인터넷 연결이 끊겨 저장하지 못했습니다. 다시 저장하세요.');
    } finally {
      setBusy(false);
    }
  }

  const shown = filter.trim()
    ? items.filter(i => `${i.no} ${i.product_name} ${i.width_mm} ${i.height_mm}`.includes(filter.trim()))
    : items;
  const lineOptions = activeLines(lines);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { reset(); setOpen(true); }}>
        <Pencil />품목 수정
      </Button>
      {open && (
        <Dialog open onOpenChange={o => { if (!o && !busy) setOpen(false); }}>
          <DialogContent className="max-h-[92vh] gap-4 overflow-y-auto p-6 sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">작업의뢰서 {number} 품목 수정</DialogTitle>
              <DialogDescription>
                MES 바코드로 센 내용입니다. 수량 · 품명 · 규격을 고치거나, 빠진 품목을 더하거나, 잘못 들어간 품목을 지울 수 있습니다.
                수량을 고치면 생산 기록도 함께 바뀝니다(늘린 수량은 마지막 생산일에 더하고, 줄인 수량은 마지막 생산일부터 뺍니다).
              </DialogDescription>
            </DialogHeader>

            {items.length > 12 && (
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="No · 품명 · 규격 검색" className={`${input} h-10 px-3`} />
            )}

            {/* 있는 품목 */}
            <div className="max-h-[42vh] overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="w-12 py-2 text-center font-semibold">No</th>
                    <th className="py-2 text-left font-semibold">품명 · 규격</th>
                    <th className="w-16 py-2 text-right font-semibold">현재</th>
                    <th className="w-24 py-2 text-right font-semibold">수정 수량</th>
                    <th className="w-24 py-2 pr-2 text-right font-semibold">고치기 · 삭제</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map(i => {
                    const gone = removed.has(i.id);
                    const v = qty[i.id] ?? '';
                    const s = spec[i.id];
                    const changed = !gone && ((v !== '' && Number(v) !== i.quantity) || !!s);
                    return (
                      <tr key={i.id} className={gone ? 'bg-destructive/5 text-muted-foreground' : changed ? 'bg-brand-50/60' : ''}>
                        <td className="tabular py-1.5 text-center font-semibold">{i.no}</td>
                        <td className="py-1.5">
                          {s && !gone ? (
                            <div className="space-y-1.5 pr-2">
                              <input aria-label={`No.${i.no} 품명`} list="mes-item-names" value={s.name}
                                onChange={e => setSpec(p => ({ ...p, [i.id]: { ...s, name: e.target.value } }))} className={`${input} w-full`} />
                              <div className="flex items-center gap-1.5">
                                <input aria-label={`No.${i.no} 가로`} inputMode="numeric" value={s.w} placeholder="가로"
                                  onChange={e => setSpec(p => ({ ...p, [i.id]: { ...s, w: digits(e.target.value) } }))} className={`${input} tabular w-24 text-right`} />
                                <span className="text-muted-foreground">×</span>
                                <input aria-label={`No.${i.no} 세로`} inputMode="numeric" value={s.h} placeholder="세로"
                                  onChange={e => setSpec(p => ({ ...p, [i.id]: { ...s, h: digits(e.target.value) } }))} className={`${input} tabular w-24 text-right`} />
                                <span className="text-xs text-muted-foreground">mm</span>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className={`break-keep text-[13px] leading-snug ${gone ? 'line-through' : ''}`}>{i.product_name}</p>
                              <p className="tabular text-xs text-muted-foreground">{sizeText(i.width_mm, i.height_mm)}{gone && ' · 지웁니다(생산 기록도 함께)'}</p>
                            </>
                          )}
                        </td>
                        <td className="tabular py-1.5 text-right">{i.quantity}</td>
                        <td className="py-1.5 text-right">
                          <input inputMode="numeric" aria-label={`No.${i.no} 수정 수량`} value={gone ? '' : v} placeholder={String(i.quantity)} disabled={gone}
                            onChange={e => setQty(prev => ({ ...prev, [i.id]: digits(e.target.value) }))}
                            className={`${input} tabular w-20 text-right disabled:opacity-40`} />
                        </td>
                        <td className="py-1.5 pr-2 text-right">
                          {gone ? (
                            <Button type="button" variant="ghost" size="sm" onClick={() => setRemoved(p => { const n = new Set(p); n.delete(i.id); return n; })}>
                              <RotateCcw />되돌리기
                            </Button>
                          ) : (
                            <span className="inline-flex gap-1">
                              <Button type="button" variant={s ? 'secondary' : 'ghost'} size="icon" aria-label={`No.${i.no} 품명 · 규격 고치기`}
                                onClick={() => setSpec(p => { const n = { ...p }; if (n[i.id]) delete n[i.id]; else n[i.id] = { name: i.product_name, w: String(i.width_mm), h: String(i.height_mm) }; return n; })}>
                                <Pencil />
                              </Button>
                              <Button type="button" variant="ghost" size="icon" aria-label={`No.${i.no} 삭제`} className="text-destructive hover:text-destructive"
                                onClick={() => setRemoved(p => new Set(p).add(i.id))}>
                                <Trash2 />
                              </Button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <datalist id="mes-item-names">{names.map(n => <option key={n} value={n} />)}</datalist>

            {/* 품목 더하기 */}
            <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">품목 추가</p>
                {openMissing.length > 0 && (
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    MES 에 안 찍힌 번호
                    {openMissing.slice(0, 12).map(n => (
                      <button key={n} type="button" onClick={() => addRow(n)}
                        className="tabular rounded-md border border-warning/50 bg-warning-50 px-2 py-1 text-xs font-semibold text-foreground hover:bg-warning/20">
                        No.{n} 추가
                      </button>
                    ))}
                  </span>
                )}
                <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => addRow()}><Plus />새 품목</Button>
              </div>
              {adds.length === 0 && (
                <p className="text-xs text-muted-foreground">더한 품목은 작업의뢰서에 그 번호로 들어가고, 목록은 번호 순서로 다시 정렬됩니다.</p>
              )}
              {adds.map(a => (
                <div key={a.key} className="space-y-2 rounded-lg border bg-card p-2.5">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">No
                      <input aria-label="새 품목 No" inputMode="numeric" value={a.no} onChange={e => patchAdd(a.key, { no: digits(e.target.value) })} className={`${input} tabular w-14 text-center`} />
                    </label>
                    <input aria-label="새 품목 품명" list="mes-item-names" value={a.name} placeholder="품명" onChange={e => patchAdd(a.key, { name: e.target.value })} className={`${input} min-w-0 flex-1`} />
                    <Button type="button" variant="ghost" size="icon" aria-label="이 줄 빼기" onClick={() => setAdds(p => p.filter(x => x.key !== a.key))}><X /></Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex items-center gap-1.5">
                      <input aria-label="새 품목 가로" inputMode="numeric" value={a.w} placeholder="가로" onChange={e => patchAdd(a.key, { w: digits(e.target.value) })} className={`${input} tabular w-20 text-right`} />
                      <span className="text-muted-foreground">×</span>
                      <input aria-label="새 품목 세로" inputMode="numeric" value={a.h} placeholder="세로" onChange={e => patchAdd(a.key, { h: digits(e.target.value) })} className={`${input} tabular w-20 text-right`} />
                    </span>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">수량
                      <input aria-label="새 품목 수량" inputMode="numeric" value={a.qty} onChange={e => patchAdd(a.key, { qty: digits(e.target.value) })} className={`${input} tabular w-16 text-right`} />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">생산일
                      <input aria-label="새 품목 생산일" type="date" value={a.date} onChange={e => patchAdd(a.key, { date: e.target.value })} className={`${input} tabular`} />
                    </label>
                    {a.date && lineOptions.length > 1 && (
                      <select aria-label="새 품목 호기" value={a.line} onChange={e => patchAdd(a.key, { line: Number(e.target.value) })} className={input}>
                        {lineOptions.map(l => <option key={l.line_number} value={l.line_number}>{l.name}</option>)}
                      </select>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {a.date ? `${a.date} 에 만든 것으로 생산 기록까지 남깁니다. 아직 안 만든 품목이면 생산일을 비우세요.` : '생산일이 비어 있어 아직 안 만든 품목으로 들어갑니다.'}
                  </p>
                </div>
              ))}
            </div>

            <DialogFooter className="-mx-6 -mb-6 items-center px-6">
              <p className={`mr-auto text-sm ${problem ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>{problem || (changes ? summary : '바꾼 내용이 없습니다')}</p>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>취소</Button>
              <Button type="button" onClick={save} disabled={busy || !!problem || changes === 0}>{busy ? '저장 중…' : '저장'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
