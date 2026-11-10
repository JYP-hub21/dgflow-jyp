/**
 * 마스터 관리(품명 · 거래처 · 현장 · 원판) 저장 · 삭제 결과 읽기.
 *
 * 2026-11-10 점검: 화면이 Supabase 결과를 보지 않아, 제품코드가 겹치거나(UNIQUE) 다른 자료가 쓰는 거래처를
 * 지우려 해서 DB 가 거절해도 창이 닫히고 아무 말이 없었다("저장했는데 그대로"). 또 RLS 에 막힌 수정 · 삭제는
 * 오류 없이 0줄로 끝나므로 `.select('id')` 로 바뀐 줄을 받아 0줄도 실패로 친다.
 */

export interface DbError { code?: string | null; message: string }

export type MasterAction = '저장' | '삭제';

/** DB 오류를 사람이 읽을 말로 */
export function masterErrorText(error: DbError, action: MasterAction, duplicate = '같은 값이 이미 있습니다.'): string {
  switch (error.code) {
    case '23505': return duplicate;
    case '23503':
      return action === '삭제'
        ? '이 항목을 쓰는 주문 · 작업의뢰서 등 다른 자료가 있어 삭제할 수 없습니다.'
        : '연결할 항목을 찾을 수 없습니다. 선택한 값을 다시 확인하세요.';
    case '23502': return '비워 둘 수 없는 칸이 비어 있습니다.';
    case '22P02': return '입력값 형식이 맞지 않습니다. 빈칸 · 숫자 칸을 확인하세요.';
    case '42501': return `${action} 권한이 없습니다 (마스터 관리 권한이 필요합니다).`;
    default: return `${action}하지 못했습니다: ${error.message}`;
  }
}

/**
 * 저장 · 삭제 결과 → 실패면 알릴 말, 성공이면 null.
 * `data` 는 `.select('id')` 로 받은 바뀐 줄 — 오류 없이 0줄이면 권한(RLS)에 막혔거나 그사이 지워진 것이다.
 */
export function masterResultError(
  res: { data: unknown[] | null; error: DbError | null },
  action: MasterAction,
  duplicate?: string,
): string | null {
  if (res.error) return masterErrorText(res.error, action, duplicate);
  if (!res.data || res.data.length === 0) {
    return `${action}되지 않았습니다 — 권한이 없거나 이미 삭제된 항목입니다. 새로 고침하세요.`;
  }
  return null;
}

/** 거래처 삭제 확인 글 — 현장이 거래처에 매여 있어(ON DELETE CASCADE) 함께 지워진다는 것을 수와 이름으로 알린다 */
export function customerDeleteText(customerName: string, siteCount: number, siteNames: string[] = []): string {
  if (siteCount <= 0) return `"${customerName}" 거래처를 삭제하시겠습니까?`;
  const shown = siteNames.slice(0, 5).join(', ');
  const more = siteCount > Math.min(siteNames.length, 5) ? ` 외 ${siteCount - Math.min(siteNames.length, 5)}곳` : '';
  return `"${customerName}" 거래처를 삭제하면 이 거래처의 현장 ${siteCount}곳도 함께 삭제됩니다.\n`
    + (shown ? `(${shown}${more})\n` : '')
    + '되돌릴 수 없습니다. 삭제하시겠습니까?';
}
