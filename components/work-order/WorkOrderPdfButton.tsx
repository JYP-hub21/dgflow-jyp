'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Printer, Loader2 } from 'lucide-react';

interface Props {
  /** 캡처할 요소 id */
  targetId: string;
  /** 저장될 파일명 (확장자 제외) */
  fileName: string;
}

/**
 * 작업의뢰서를 A4 PDF로 내려받는다.
 *
 * 화면에 그려진 양식을 그대로 캡처해 한 장짜리 PDF에 얹는다.
 * Tailwind v4가 쓰는 oklch() 색을 원본 html2canvas가 해석하지 못해
 * html2canvas-pro를 쓰고, 양식 자체도 hex 색으로만 그린다.
 */
export default function WorkOrderPdfButton({ targetId, fileName }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    setBusy(true);
    setError('');

    try {
      const element = document.getElementById(targetId);
      if (!element) throw new Error('의뢰서 영역을 찾지 못했습니다.');

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
      ]);

      const canvas = await html2canvas(element, {
        scale: 2, // 인쇄해도 글씨가 깨지지 않을 정도
        backgroundColor: '#ffffff',
        useCORS: true,
      });

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // 가로를 A4에 맞추고, 세로가 넘치면 페이지를 나눠 얹는다
      const imgHeight = (canvas.height * pageWidth) / canvas.width;
      const image = canvas.toDataURL('image/jpeg', 0.95);

      let remaining = imgHeight;
      let offset = 0;
      while (remaining > 0) {
        pdf.addImage(image, 'JPEG', 0, offset, pageWidth, imgHeight);
        remaining -= pageHeight;
        if (remaining > 0) {
          offset -= pageHeight;
          pdf.addPage();
        }
      }

      pdf.save(`${fileName}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF 생성에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-sm font-medium text-destructive">{error}</span>}
      <Button variant="outline" onClick={() => window.print()} disabled={busy}>
        <Printer />
        인쇄
      </Button>
      <Button onClick={download} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Download />}
        {busy ? 'PDF 만드는 중…' : 'PDF 다운로드'}
      </Button>
    </div>
  );
}
