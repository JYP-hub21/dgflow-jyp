'use client';

import { useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';

/**
 * 파일 끌어다 놓기 — 올리기 상자에 붙인다.
 *
 * 2026-11-02 사용자 피드백: "작업의뢰서에 엑셀 · PDF 를 갖다 놓아도 안 들어가고 내 컴퓨터에 다운로드가 된다".
 * 상자가 눌러서 고르기(<input type="file">)만 받아서, 놓은 파일은 브라우저가 열거나 내려받았다.
 * 놓은 파일을 고른 것과 똑같이 onFiles 로 넘긴다. accept 는 input 의 accept 와 같은 꼴(".xlsx,.xls,.pdf").
 * 상자 밖에 놓은 파일은 components/layout/FileDropGuard 가 막는다.
 */
export function useFileDrop({ onFiles, accept, multiple = true, disabled = false }: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  // 상자 안의 글자 · 아이콘 위를 지날 때마다 enter/leave 가 번갈아 와서, 깊이를 세어 깜빡이지 않게 한다
  const depth = useRef(0);
  const exts = (accept ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const fits = (f: File) => exts.length === 0 || exts.some(x => f.name.toLowerCase().endsWith(x));

  const dropProps = {
    'data-file-drop': '',
    onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      if (!disabled) setDragging(true);
    },
    onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    },
    onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (disabled) return;
      const all = Array.from(e.dataTransfer.files);
      const good = all.filter(fits);
      const bad = all.filter(f => !fits(f));
      if (bad.length > 0) {
        toast.error(`업로드할 수 없는 파일입니다: ${bad.map(f => f.name).join(', ')} (${exts.join(' · ')} 형식만 가능합니다)`);
      }
      if (good.length === 0) return;
      if (!multiple && good.length > 1) toast.info(`파일은 하나만 업로드할 수 있어 ${good[0].name} 만 읽었습니다.`);
      onFiles(multiple ? good : good.slice(0, 1));
    },
  };
  return { dragging, dropProps };
}

/** 끌고 있는 것이 파일인지 (글자 · 그림 끌기는 건드리지 않는다) */
export function hasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}
