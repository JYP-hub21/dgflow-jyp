'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { hasFiles } from '@/components/ui/file-drop';

/**
 * 올리기 상자 밖에 놓은 파일을 막는다 — 그냥 두면 브라우저가 그 파일을 열거나 내려받는다
 * (2026-11-02 사용자 피드백 "파일을 갖다 놓았더니 내 컴퓨터에 다운로드가 됐다").
 * 올리기 상자(useFileDrop)가 이미 받은 파일은 건드리지 않는다 — 상자가 먼저 preventDefault 한다.
 */
export default function FileDropGuard() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      // 올리기 상자가 있는 화면이면 어디에 놓아야 하는지 알려 준다
      if (document.querySelector('[data-file-drop]')) toast.info('파일은 점선으로 표시된 업로드 영역 안에 놓으세요.');
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return null;
}
