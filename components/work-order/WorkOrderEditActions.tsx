'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Pencil, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button, buttonVariants } from '@/components/ui/button';

/**
 * 작업의뢰서 수정 · 삭제 버튼 (2026-11-06 회의). 수정은 등록 화면을 그 의뢰서로 연다.
 * 삭제는 생산 · 재단 기록이 있으면 건수를 보여 주고 한 번 더 확인한다.
 */
export default function WorkOrderEditActions({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<{ productionLogs: number; cuttingLogs: number } | null>(null);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/work-orders/${id}${logs ? '?force=1' : ''}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json.code === 'HAS_LOGS') {
        setLogs({ productionLogs: json.productionLogs, cuttingLogs: json.cuttingLogs });
        return;
      }
      if (!res.ok) { toast.error(json.error ?? '삭제하지 못했습니다.'); return; }
      toast.success(`작업의뢰서 ${number} 를 삭제했습니다.`);
      router.push('/work-orders');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link href={`/work-orders/receive?edit=${id}`} className={buttonVariants({ variant: 'outline' })}>
        <Pencil />수정
      </Link>
      <Button variant="outline" onClick={() => { setLogs(null); setOpen(true); }} className="text-destructive hover:text-destructive">
        <Trash2 />삭제
      </Button>
      {open && (
        <Dialog open onOpenChange={o => { if (!o) setOpen(false); }}>
          <DialogContent className="gap-4 p-6 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">작업의뢰서 {number} 삭제</DialogTitle>
              <DialogDescription>
                {logs
                  ? `생산 기록 ${logs.productionLogs}건 · 재단 기록 ${logs.cuttingLogs}건이 함께 삭제되며 되돌릴 수 없습니다. 그래도 삭제하시겠습니까?`
                  : '이 작업의뢰서와 품목을 삭제합니다. 되돌릴 수 없습니다.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="-mx-6 -mb-6 px-6">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>취소</Button>
              <Button type="button" variant="destructive" onClick={remove} disabled={busy}>
                {busy ? '삭제 중…' : logs ? '기록까지 삭제' : '삭제'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
