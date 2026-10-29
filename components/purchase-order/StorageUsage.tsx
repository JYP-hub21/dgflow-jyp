'use client';

import { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/purchase-order/chunks';

interface Usage { used: number; limit: number; purgeable_bytes: number; purgeable_files: number }

/**
 * 저장 공간 (마스터에게만). 무료 요금제는 1GB 라 발주서 원본이 쌓이면 찬다.
 * 끝난 건(완료 · 취소)의 파일을 지워 비울 수 있다.
 */
export default function StorageUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => fetch('/api/purchase-orders/cleanup').then(r => (r.ok ? r.json() : null)).then(j => j && setUsage(j.data));
  useEffect(() => { load(); }, []);
  if (!usage) return null;

  const pct = Math.round(usage.used / usage.limit * 100);
  async function purge() {
    if (!usage || !confirm(`끝난 발주 건의 파일 ${usage.purgeable_files}개(${formatBytes(usage.purgeable_bytes)})를 지울까요?\n파일 이름과 이력은 남습니다. 지운 파일은 되살릴 수 없습니다.`)) return;
    setBusy(true);
    const res = await fetch('/api/purchase-orders/cleanup', { method: 'POST' });
    setBusy(false);
    if (!res.ok) { toast.error('정리하지 못했습니다.'); return; }
    const { data } = await res.json();
    toast.success(`${formatBytes(data.freed)} 를 비웠습니다.`);
    load();
  }

  return (
    <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
      <HardDrive className="h-4 w-4" />
      <span className={cn(pct >= 80 && 'font-bold text-destructive')}>
        발주서 파일 {formatBytes(usage.used)} / {formatBytes(usage.limit)} ({pct}%)
      </span>
      {usage.purgeable_files > 0 && (
        <button type="button" onClick={purge} disabled={busy}
          className="rounded-md border border-input px-2 py-1 font-medium text-foreground hover:bg-accent">
          끝난 건 정리 ({formatBytes(usage.purgeable_bytes)})
        </button>
      )}
    </div>
  );
}
