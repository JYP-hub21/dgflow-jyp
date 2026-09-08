'use client';

import { Button } from '@/components/ui/button';
import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';

export default function ExcelDownloadButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    const res = await fetch(`/api/orders/${orderId}/excel`);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `주문의뢰서_${orderId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setLoading(false);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleDownload} disabled={loading}>
      <FileSpreadsheet className="mr-2 h-4 w-4" />
      {loading ? '생성 중...' : '엑셀 다운로드'}
    </Button>
  );
}
