/**
 * 작업의뢰서 등록 화면 — 파일을 올렸을 때 표를 어떻게 바꿀지 (2026-11-10 점검).
 *
 * 사고: 표에 품목이 이미 있으면 새 PDF 는 머리글만 바꿨다. 2090 을 올린 뒤 2573 을 올리면(또는 둘을 한 번에 놓으면)
 * 머리글은 2573, 품목 · 소계 · 합계는 2090 이 남고, 검산은 2090 을 2090 과 맞춰 초록이 떴다.
 * 수정 화면에서 고친 ERP 파일을 다시 올려도 품목이 안 바뀌었다.
 *
 * 규칙 —
 *  · 표의 품목이 어디서 왔는지(`RowsOrigin`)를 상태로 들고 다닌다. 짐작하지 않는다
 *  · 새 파일의 품목은 이전 파일 · 등록된(DB) 품목을 그냥 갈아 끼운다 — 무엇을 바꿨는지 알린다
 *  · 손으로 친 품목(또는 파일에서 온 뒤 손으로 고친 품목)만 갈아 끼우기 전에 확인을 받는다
 *  · 수정 중인 의뢰서와 의뢰번호가 다른 파일은 확인을 받는다
 *  · 한 번에 엑셀과 PDF 를 같이 놓으면 품목은 엑셀, 머리글은 PDF (같은 의뢰서의 두 출력물이다)
 *  · 한 번에 PDF 둘(또는 엑셀 둘)은 어느 쪽을 쓸지 정할 수 없어 받지 않는다
 */

export interface RowsOrigin {
  kind: 'empty' | 'hand' | 'file' | 'db';
  /** 파일 이름 (file) · 의뢰번호 (db) */
  name?: string;
  /** 파일 · DB 에서 온 뒤 손으로 고쳤나 */
  edited: boolean;
}

export const EMPTY_ORIGIN: RowsOrigin = { kind: 'empty', edited: false };

/** 손으로 고쳤다 — 빈 표에서 시작했으면 손으로 친 표가 된다 */
export function markEdited(o: RowsOrigin): RowsOrigin {
  return o.kind === 'empty' ? { kind: 'hand', edited: true } : { ...o, edited: true };
}

const isPdf = (f: { name: string }) => f.name.toLowerCase().endsWith('.pdf');

/** 한 번에 놓은 파일 — PDF 하나 · 엑셀 하나까지 */
export function pickBatch<F extends { name: string }>(files: F[]): { pdf?: F; excel?: F } | { error: string } {
  const pdfs = files.filter(isPdf);
  const excels = files.filter((f) => !isPdf(f));
  if (pdfs.length > 1 || excels.length > 1) {
    const many = pdfs.length > 1 ? `PDF ${pdfs.length}개` : `엑셀 ${excels.length}개`;
    return { error: `${many}를 한 번에 업로드했습니다 — 사용할 의뢰서를 판단할 수 없어 읽지 않았습니다. 작업의뢰서는 한 장씩 업로드하세요.` };
  }
  return { pdf: pdfs[0], excel: excels[0] };
}

/** 품목을 갈아 끼우기 전에 물어야 하나 — 사람이 친 것이 있을 때만 */
export function needsHandConfirm(origin: RowsOrigin, rowsWithContent: number): boolean {
  return rowsWithContent > 0 && (origin.kind === 'hand' || origin.edited);
}

/** 수정 중인 의뢰서와 다른 번호의 파일인가 */
export function isOtherNumber(editing: string | null | undefined, fileNumber: string | null | undefined): boolean {
  const a = editing?.trim();
  const b = fileNumber?.trim();
  return !!a && !!b && a !== b;
}

interface SizeQty { width_mm: number; height_mm: number; quantity: number }

/** 규격 · 수량이 줄마다 같은가 — 엑셀 ↔ PDF, 이전 표 ↔ 새 파일 비교 */
export function sameItems(a: SizeQty[], b: SizeQty[]): boolean {
  return a.length === b.length
    && a.every((x, i) => x.width_mm === b[i].width_mm && x.height_mm === b[i].height_mm && x.quantity === b[i].quantity);
}

/** 바뀐 것을 알리는 말 — "이전 파일 26-2090.pdf 의 품목 17행" 처럼. 갈아 끼울 게 없었으면 null */
export function replacedLabel(origin: RowsOrigin, count: number): string | null {
  if (count === 0) return null;
  const edited = origin.edited ? '(직접 수정 포함) ' : '';
  switch (origin.kind) {
    case 'file': return `이전 파일 ${origin.name ?? ''} 의 품목 ${edited}${count}행`;
    case 'db': return `기존 등록 품목 ${edited}${count}행`;
    case 'hand': return `직접 입력한 품목 ${count}행`;
    default: return null;
  }
}
