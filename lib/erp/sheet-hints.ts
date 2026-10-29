/**
 * 발주서 시트에서 포장 단위 판단에 쓸 원문을 모은다.
 *
 * 화면과 테스트가 **같은 경로**를 타도록 여기 한 곳에 둔다.
 * (전에는 테스트가 행 번호를 직접 지정하고 화면은 휴리스틱을 써서,
 *  테스트는 통과하는데 화면에서는 포장 분리가 안 되는 일이 있었다.)
 */
import * as XLSX from 'xlsx';

export interface SheetHints {
  /** 상단 자유 서식 영역 — 행 단위로 합친 문자열 */
  topLines: string[];
  /** 시트 전체에서 "같이 포장" 이 들어간 셀 텍스트 */
  markerCells: string[];
}

const TOP_ROWS = 20;

export function collectSheetHints(buffer: ArrayBuffer, sheetName: string): SheetHints {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  return hintsFromWorksheet(wb.Sheets[sheetName]);
}

export function hintsFromWorksheet(ws: XLSX.WorkSheet | undefined): SheetHints {
  if (!ws) return { topLines: [], markerCells: [] };

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });

  const topLines = rows
    .slice(0, TOP_ROWS)
    .map(r => (Array.isArray(r) ? r.map(c => String(c ?? '')).join(' ') : ''));

  const markerCells: string[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const text = String(cell ?? '');
      if (/같이\s*포장/.test(text)) markerCells.push(text);
    }
  }

  return { topLines, markerCells };
}
