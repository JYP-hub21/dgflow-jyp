'use client';

import { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/purchase-order/chunks';
import type { CleanupOrder } from '@/lib/purchase-order/cleanup';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface Usage { used: number; limit: number; purgeable_bytes: number; purgeable_files: number; orders: CleanupOrder[] }

/**
 * 저장 공간 (마스터에게만). 무료 요금제는 1GB 라 발주서 원본이 쌓이면 찬다.
 * 끝난 건(완료 · 취소)의 파일을 지워 비울 수 있다.
 *
 * 지우기 전에 **어느 발주서의 원본이 지워지는지 건마다 보여 주고 고른 건만** 지운다 (2026-11-10 점검 — 예전에는
 * "파일 n개를 지울까요?" 한 줄이었다). '완료' 는 지금 이어진 작업의뢰서를 다 만들었다는 뜻이라, 차수가 남은 발주서도
 * 완료로 보일 수 있다 — 그런 건은 빼고 지우게 창에서 알린다.
 */
export default function StorageUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = () => fetch('/api/purchase-orders/cleanup')
    .then(r => (r.ok ? r.json() : null))
    .then(j => { if (j) setUsage(j.data); return (j?.data ?? null) as Usage | null; });
  useEffect(() => { load(); }, []);
  if (!usage) return null;

  const pct = Math.round(usage.used / usage.limit * 100);
  const chosen = usage.orders.filter(o => picked.has(o.id));
  const chosenFiles = chosen.reduce((n, o) => n + o.files, 0);
  const chosenBytes = chosen.reduce((n, o) => n + o.bytes, 0);

  // 창을 열 때 다시 읽는다 — 그사이 진행 중으로 돌아간 건이 목록에 남지 않게
  async function openDialog() {
    const fresh = await load();
    if (!fresh || fresh.orders.length === 0) { toast.info('정리할 수 있는 완료된 발주서가 없습니다.'); return; }
    setPicked(new Set(fresh.orders.map(o => o.id)));
    setOpen(true);
  }

  function toggle(id: string) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function purge() {
    if (chosen.length === 0) return;
    setBusy(true);
    const res = await fetch('/api/purchase-orders/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchase_order_ids: chosen.map(o => o.id) }),
    });
    setBusy(false);
    const j = await res.json().catch(() => null);
    if (!res.ok) { toast.error(j?.error ?? '정리하지 못했습니다.'); return; }
    const { freed, files, failed } = j.data;
    if (failed > 0) toast.warning(`${formatBytes(freed)}를 확보했습니다. 파일 ${failed}개는 삭제하지 못했습니다.`);
    else toast.success(`발주서 ${j.data.orders}건 · 파일 ${files}개 — ${formatBytes(freed)}를 확보했습니다.`);
    setOpen(false);
    load();
  }

  return (
    <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
      <HardDrive className="h-4 w-4" />
      <span className={cn(pct >= 80 && 'font-bold text-destructive')}>
        발주서 파일 {formatBytes(usage.used)} / {formatBytes(usage.limit)} ({pct}%)
      </span>
      {usage.purgeable_files > 0 && (
        <button type="button" onClick={openDialog} disabled={busy}
          className="rounded-md border border-input px-2 py-1 font-medium text-foreground hover:bg-accent">
          완료 건 정리 ({formatBytes(usage.purgeable_bytes)})
        </button>
      )}
      {open && (
        <Dialog open onOpenChange={o => { if (!o && !busy) setOpen(false); }}>
          <DialogContent className="gap-4 p-6 sm:max-w-xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">완료된 발주서 파일 정리</DialogTitle>
              <DialogDescription>
                아래에서 선택한 발주서의 <b className="text-foreground">원본 · ERP 엑셀 · 규격정리 파일</b>을 저장소에서 삭제합니다.
                파일 이름과 이력은 남지만 <b className="text-destructive">삭제한 파일은 복구할 수 없습니다.</b>
              </DialogDescription>
            </DialogHeader>
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-[13px] text-foreground">
              &lsquo;완료&rsquo;는 지금 연결된 작업의뢰서를 모두 생산했다는 뜻입니다. 발주서에 아직 ERP에 입력하지 않은 차수가 남아 있으면
              그 원본도 함께 삭제되므로, 그런 건은 체크를 해제하세요.
            </p>
            <ul className="-mx-1 max-h-[45vh] space-y-1 overflow-y-auto px-1">
              {usage.orders.map(o => (
                <li key={o.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand-800"
                      checked={picked.has(o.id)} onChange={() => toggle(o.id)} disabled={busy} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <b className="text-sm text-foreground">{o.intake_number}</b>
                        <span className="truncate text-sm text-foreground">{o.name || '-'}</span>
                        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold',
                          o.state === 'done' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
                          {o.state === 'done' ? `완료 · 작업의뢰서 ${o.work_orders}장` : '취소'}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {o.order_files.length > 0 && <>원본 {o.order_files.join(', ')}</>}
                        {o.order_files.length > 0 && o.made_files > 0 && ' · '}
                        {o.made_files > 0 && <>ERP · 규격정리 {o.made_files}개</>}
                        {' · '}{formatBytes(o.bytes)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <DialogFooter className="-mx-6 -mb-6 px-6 sm:items-center">
              <span className="text-xs text-muted-foreground sm:mr-auto">
                {chosen.length}건 · 파일 {chosenFiles}개 · {formatBytes(chosenBytes)}
              </span>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>취소</Button>
              <Button type="button" variant="destructive" onClick={purge} disabled={busy || chosen.length === 0}>
                {busy ? '삭제 중…' : `${chosen.length}건 파일 삭제`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
