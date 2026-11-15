/**
 * MES 생산실적 파일 읽기 — 바이트 → 한 장씩 (lib/production/mes.ts).
 *
 * xlsx 는 빠른 줄 읽기(lib/excel/xlsx-rows.ts)로, 예전 xls · csv 는 SheetJS 로 읽는다.
 * 시트는 'Data' 를 먼저 보고, 없으면 의뢰번호 · NO · 라인 · 일자 머리가 있는 첫 시트를 쓴다
 * (Report 피벗 시트도 머리는 맞지만 바코드가 없어 같은 장을 두 번 셀 수 있으니 뒤로 미룬다).
 * 화면에서는 작업자 스레드(mes-worker.ts)가 부른다 — 큰 파일을 읽는 동안 화면이 멈추지 않게.
 */
import * as XLSX from 'xlsx';
import { openXlsx } from '@/lib/excel/xlsx-rows';
import { decodeCsv } from '@/lib/excel/read-file';
import { MesCollector, type MesParse } from './mes';

/** 머리 줄은 이 줄 안에서 찾는다 */
const HEADER_WITHIN = 30;

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
const sheetOrder = (name: string) => (name.trim().toLowerCase() === 'data' ? 0 : /report|피벗|정리/i.test(name) ? 2 : 1);

export async function parseMesBytes(bytes: ArrayBuffer, fileName: string, onProgress?: (rows: number) => void): Promise<MesParse> {
  const buf = new Uint8Array(bytes);
  let firstMissing: string[] | null = null;

  if (isZip(buf)) {
    const book = await openXlsx(buf);
    const sheets = [...book.sheets].sort((a, b) => sheetOrder(a.name) - sheetOrder(b.name));
    for (const sheet of sheets) {
      const c = new MesCollector(book.date1904);
      await book.eachRow(sheet.path, (cells, row) => {
        c.add(cells, row);
        return c.headerFound || row < HEADER_WITHIN;
      }, onProgress);
      if (c.headerFound) return c.result(sheet.name);
      firstMissing ??= c.missingColumns();
    }
  } else {
    const wb = fileName.toLowerCase().endsWith('.csv')
      ? XLSX.read(decodeCsv(bytes), { type: 'string', raw: true })
      : XLSX.read(buf, { type: 'array' });
    const names = [...wb.SheetNames].sort((a, b) => sheetOrder(a) - sheetOrder(b));
    for (const name of names) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true, blankrows: true });
      const c = new MesCollector(false);
      rows.forEach((r, i) => c.add(r, i + 1));
      if (c.headerFound) return c.result(name);
      firstMissing ??= c.missingColumns();
    }
  }
  throw new Error(`MES 생산실적 표를 찾지 못했습니다. 필요한 칸: ${(firstMissing ?? ['의뢰번호', 'NO.', '라인', '일자']).join(', ')}`);
}
