/**
 * 엑셀 파싱 워커
 *
 * 발주서 파일은 144MB 짜리도 있다(KCC 여의도 — 시트는 1,057행뿐인데 이미지가 잔뜩 들어 있다).
 * 브라우저에서 `XLSX.read` 한 번이 13초쯤 걸리는데, 이게 **동기 함수**라 메인 스레드를
 * 통째로 잡아먹는다. 그 동안 버튼이 아무것도 안 눌리고 크롬이 "응답 없는 페이지" 를 띄운다.
 *
 * Node 에서는 같은 파일이 0.6초다 — SheetJS 에 Node Buffer 전용 빠른 경로가 있어서다.
 * 브라우저에서 쓸 수 있는 입력(ArrayBuffer · Uint8Array · 바이너리 문자열)은 전부 4.5~6초라
 * 입력 형태를 바꿔서는 해결되지 않는다. 그래서 파싱 자체를 워커로 옮긴다.
 *
 * 워커는 파싱 결과(시트 이름 + 셀 데이터)만 돌려준다. 이미지 같은 건 SheetJS 가 들고 있지 않아
 * 돌려보내는 양은 작다.
 */
import * as XLSX from 'xlsx';

export interface XlsxWorkerResult {
  ok: boolean;
  /** XLSX.WorkBook 과 같은 모양 — 메인 스레드에서 그대로 쓴다 */
  workbook?: { SheetNames: string[]; Sheets: Record<string, XLSX.WorkSheet> };
  error?: string;
}

// DOM 타입과 섞이지 않게 필요한 부분만 좁혀서 쓴다
const ctx = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<ArrayBuffer>) => void): void;
  postMessage(message: XlsxWorkerResult): void;
};

ctx.addEventListener('message', event => {
  try {
    const wb = XLSX.read(event.data, { type: 'array', cellDates: true });
    ctx.postMessage({
      ok: true,
      workbook: { SheetNames: wb.SheetNames, Sheets: wb.Sheets },
    });
  } catch (err) {
    ctx.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : '엑셀을 읽지 못했습니다.',
    });
  }
});
