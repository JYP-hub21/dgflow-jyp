/**
 * MES 생산실적 파일을 작업자 스레드에서 읽는다 — 25MB · 30만 줄 파일도 화면이 멈추지 않게 (lib/production/mes-read.ts).
 */
import { parseMesBytes } from './mes-read';
import type { MesParse } from './mes';

export type MesWorkerMessage =
  | { type: 'progress'; rows: number }
  | { type: 'done'; result: MesParse }
  | { type: 'error'; message: string };

const ctx = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<{ bytes: ArrayBuffer; name: string }>) => void): void;
  postMessage(message: MesWorkerMessage): void;
};

ctx.addEventListener('message', async event => {
  const { bytes, name } = event.data;
  let last = 0;
  try {
    const result = await parseMesBytes(bytes, name, rows => {
      // 너무 자주 보내지 않게 — 2만 줄마다
      if (rows - last >= 20_000) { last = rows; ctx.postMessage({ type: 'progress', rows }); }
    });
    ctx.postMessage({ type: 'done', result });
  } catch (e) {
    ctx.postMessage({ type: 'error', message: e instanceof Error ? e.message : '파일을 읽지 못했습니다.' });
  }
});
