import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { listOrderSheets, parseOrderExcel } from '../lib/parser/excel-order';

/** 차수별 시트가 여러 장인 발주서를 흉내 낸다 */
function makeWorkbook() {
  const wb = XLSX.utils.book_new();
  const sheet = (rows: number, name: string) => {
    const data = [['품명', '가로', '세로', '수량', '동', '라인', '층']];
    for (let i = 1; i <= rows; i++) data.push([`5CL+12Ar+5로이`, String(900 + i), '1820', '10', '101', String(i), '5']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), name);
  };
  sheet(3, '1차');
  sheet(5, '2차');
  sheet(12, '3차');   // 행이 가장 많은 시트 — 예전에는 이게 말없이 들어갔다
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('여러 시트 발주서', () => {
  const ab = makeWorkbook();

  it('시트 목록과 각 시트 품목 수를 알려 준다', () => {
    const sheets = listOrderSheets(ab);
    console.log('\n시트 목록:');
    sheets.forEach(s => console.log(`   ${s.recommended ? '★' : ' '} ${s.name}  품목 ${s.items}건 / ${s.rows}행`));
    expect(sheets.map(s => s.name)).toEqual(['1차', '2차', '3차']);
    expect(sheets.find(s => s.name === '3차')!.recommended).toBe(true);
  });

  it('고른 시트만 가져온다', () => {
    const only1 = parseOrderExcel(ab, { sheets: ['1차'] });
    console.log(`\n1차만 → ${only1.items.length}건 (시트: ${only1.sheetName})`);
    expect(only1.items.length).toBe(3);
  });

  it('여러 시트를 고르면 이어 붙인다', () => {
    const merged = parseOrderExcel(ab, { sheets: ['1차', '2차'] });
    console.log(`1차+2차 → ${merged.items.length}건 (시트: ${merged.sheetName})`);
    expect(merged.items.length).toBe(8);
    expect(merged.sheetNames).toEqual(['1차', '2차']);
  });

  it('안 고르면 예전처럼 가장 큰 시트를 고른다', () => {
    const auto = parseOrderExcel(ab);
    console.log(`고르지 않음 → ${auto.sheetName} 시트 ${auto.items.length}건`);
    expect(auto.sheetName).toBe('3차');
  });
});
