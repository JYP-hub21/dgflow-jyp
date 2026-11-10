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
 * 양식은 쪽마다 `.wo-page` 로 나뉘어 있다(WorkOrderSheet) — 쪽마다 따로 떠서 PDF 한 쪽씩 얹는다.
 * 예전에는 긴 양식 한 장을 297mm 마다 잘라 붙여 줄이 반으로 갈리고, 짧은 의뢰서에도 빈 2쪽이 붙었다 (2026-11-10 점검).
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

      const pages = Array.from(element.querySelectorAll<HTMLElement>('.wo-page'));
      if (pages.length === 0) throw new Error('의뢰서 페이지를 아직 나누는 중입니다. 잠시 후 다시 시도하세요.');

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i], {
          scale: 2, // 인쇄해도 글씨가 깨지지 않을 정도
          backgroundColor: '#ffffff',
          useCORS: true,
        });
        if (i > 0) pdf.addPage();
        // 쪽 하나가 정확히 A4(210×297mm)라 그대로 꽉 채운다
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageWidth, pageHeight);
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
        {busy ? 'PDF 생성 중…' : 'PDF 다운로드'}
      </Button>
    </div>
  );
}
