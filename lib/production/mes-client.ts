/**
 * 화면에서 MES 파일 읽기 — 작업자 스레드로 읽고, 스레드를 못 띄우면 화면에서 직접 읽는다(느려도 동작은 하게).
 */
import type { MesParse } from './mes';
import type { MesWorkerMessage } from './mes-worker';

export async function readMesFile(file: File, onProgress?: (rows: number) => void): Promise<MesParse> {
  const bytes = await file.arrayBuffer();
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise<MesParse>((resolve, reject) => {
        const worker = new Worker(new URL('./mes-worker.ts', import.meta.url));
        const finish = (fn: () => void) => { worker.terminate(); fn(); };
        worker.onmessage = (e: MessageEvent<MesWorkerMessage>) => {
          const m = e.data;
          if (m.type === 'progress') onProgress?.(m.rows);
          else if (m.type === 'done') finish(() => resolve(m.result));
          else finish(() => reject(new ReadError(m.message)));
        };
        worker.onerror = () => finish(() => reject(new Error('작업자 스레드를 띄우지 못했습니다.')));
        // 복사본을 넘긴다 — 스레드가 실패하면 아래에서 원본으로 다시 읽는다
        const copy = bytes.slice(0);
        worker.postMessage({ bytes: copy, name: file.name }, [copy]);
      });
    } catch (e) {
      // 파일 내용 문제(머리 칸 없음 등)는 그대로 알리고, 스레드 문제만 아래로 내려간다
      if (e instanceof ReadError) throw new Error(e.message);
    }
  }
  const { parseMesBytes } = await import('./mes-read');
  return parseMesBytes(bytes, file.name, onProgress);
}

class ReadError extends Error {}
