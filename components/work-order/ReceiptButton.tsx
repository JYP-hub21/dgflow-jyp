'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** 생산관리부 수신 확인 버튼 — 누르면 시각 · 이름이 남고 되돌리지 않는다 */
export default function ReceiptButton({ workOrderId, onDone, size }: {
  workOrderId: string;
  /** 눌린 뒤 — 없으면 화면을 새로 그린다 */
  onDone?: () => void;
  size?: 'default' | 'lg';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/receipt`, { method: 'POST' });
      if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error ?? '수신 확인을 저장하지 못했습니다.'); return; }
      toast.success('수신 확인을 저장했습니다.');
      if (onDone) onDone(); else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return <Button onClick={confirm} disabled={busy} size={size}><CheckCheck />{busy ? '저장 중…' : '수신 확인'}</Button>;
}
