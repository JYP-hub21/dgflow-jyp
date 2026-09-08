'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

export default function DeleteOrderButton({ orderId }: { orderId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    const res = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' });
    if (res.ok) {
      window.location.href = '/orders';
    } else {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-red-600">삭제하시겠습니까?</span>
        <Button size="sm" variant="destructive" onClick={handleDelete} disabled={loading}>
          {loading ? '삭제 중...' : '확인'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>취소</Button>
      </div>
    );
  }

  return (
    <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={() => setConfirming(true)}>
      <Trash2 className="mr-2 h-4 w-4" />삭제
    </Button>
  );
}
