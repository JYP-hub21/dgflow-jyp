/**
 * 엑셀을 **메인 스레드를 막지 않고** 읽는다.
 *
 * 큰 발주서는 파싱에 10초 넘게 걸리고 `XLSX.read` 는 동기라, 그 동안 화면이 통째로 멈춘다.
 * 그래서 워커에서 읽고 결과만 받아 온다. 워커를 못 쓰는 환경이면 예전처럼 동기로 읽는다 —
 * 느릴지언정 동작은 해야 한다.
 */
import * as XLSX from 'xlsx';
import type { XlsxWorkerResult } from './xlsx-worker';

/** 워커가 이 환경에서 되는지 (SSR·구형 브라우저 대비) */
function workerAvailable(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined';
}

export async function readWorkbook(buffer: ArrayBuffer): Promise<XLSX.WorkBook> {
  if (workerAvailable()) {
    try {
      return await readInWorker(buffer);
    } catch {
      // 워커가 안 뜨면(번들러·CSP 등) 조용히 동기 경로로 내려간다
    }
  }
  return XLSX.read(buffer, { type: 'array', cellDates: true });
}

function readInWorker(buffer: ArrayBuffer): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./xlsx-worker.ts', import.meta.url));

    const done = (fn: () => void) => {
      worker.terminate();
      fn();
    };

    worker.onmessage = (event: MessageEvent<XlsxWorkerResult>) => {
      const { ok, workbook, error } = event.data;
      if (ok && workbook) done(() => resolve(workbook as XLSX.WorkBook));
      else done(() => reject(new Error(error ?? '엑셀을 읽지 못했습니다.')));
    };

    worker.onerror = () => done(() => reject(new Error('워커를 띄우지 못했습니다.')));

    // 버퍼 소유권을 넘긴다 — 복사하지 않으므로 큰 파일에서도 즉시 건너간다
    worker.postMessage(buffer, [buffer]);
  });
}
