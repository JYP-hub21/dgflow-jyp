// @vitest-environment node
/**
 * 동·라인 표기가 다른 두 발주서 — 2026-10-13 실사용 피드백으로 들어온 실물.
 *
 *  - 흥화건설 행정중심 5-1L BL 1차 본물량
 *      위치 열이 3줄 블록: `102동 1,3호` / `1F~9F` / `84A` (라인 여럿, 층·타입이 한 줄씩)
 *      비고 머리글이 I:J 병합인데 I 는 0 만, 실제 비고(`거실(外)`)는 J
 *  - 계룡건설 고양장항 S-1BL 2차 본물량
 *      위치 칸 하나에 `101동6~10층1,2,3,4호거실 大` — 층이 동과 호 사이
 *      비고 오른쪽에 별도 보조표(기본·세대수·동·라인·타입…)가 붙어 있다
 *
 * 피드백: ① 102동 1,3라인을 읽지 못한다  ② G~L 칸이 위치에 중복으로 붙는다
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { scanOrderSheet, type OrderScan } from '@/lib/parser/order-scan';
import { formatUnitRange } from '@/lib/work-order/build';

const HEUNGHWA = path.join(process.cwd(), '엑셀 자료',
  '흥화건설-행정중심 복합도시 5-1L BL 21공구 1차 본물량 (2,3,4,5동) 발주서 (10.06).xlsx');
const GYERYONG = path.join(process.cwd(), '엑셀 자료',
  '계룡건설-고양장항 S-1BL 현장 본물량 2차 유리 발주서 ( 10.08 ).xlsx');

function scan(file: string, source?: OrderScan['location_source']) {
  const wb = XLSX.readFile(file);
  return scanOrderSheet(wb.Sheets[wb.SheetNames[0]], { location_source: source });
}

const row = (s: OrderScan, excelRow: number) => s.rows.find(r => r.excel_row === excelRow)!;

describe.skipIf(!fs.existsSync(HEUNGHWA))('흥화건설 — 3줄 위치 블록 · 병합된 비고', () => {
  it('102동 1,3호 를 동·라인으로 읽는다 — 층·타입은 다음 줄에서', () => {
    const r = row(scan(HEUNGHWA), 16);
    expect(r.location_dong).toBe('102동');
    expect(r.location_line).toBe('1,3호');
    expect(r.location_floor).toBe('1F~9F');
    expect(r.location_type).toBe('84A');
  });

  it('같은 102동 2호가 층마다 따로 적히면 블록을 나눈다', () => {
    const s = scan(HEUNGHWA);
    expect([row(s, 33).location_floor, row(s, 33).location_type]).toEqual(['1F', '84B']);
    expect([row(s, 56).location_floor, row(s, 56).location_type]).toEqual(['2F,4F,6F,8F', '84C']);
    expect([row(s, 71).location_floor, row(s, 71).location_type]).toEqual(['3F,5F,7F,9F', '84D']);
  });

  it('비고는 0 만 든 I 가 아니라 글자가 든 J 에서 읽는다', () => {
    const s = scan(HEUNGHWA);
    expect(s.columns.remark).toBe(9);
    expect(row(s, 15).location_text).toBe('거실(外)');
  });

  it('위치 + 비고로 읽으면 위치 블록 전체에 비고를 붙인다 (다음 쪽 머리글은 섞이지 않는다)', () => {
    const s = scan(HEUNGHWA, 'both');
    expect(row(s, 14).location_text).toBe('102동 1,3호 1F~9F 84A 거실(外)');
    expect(row(s, 21).location_text).toBe('102동 1,3호 1F~9F 84A 거실(內)');
    expect(row(s, 71).location_text).toBe('102동 2호 3F,5F,7F,9F 84D 거실(內)');
  });

  it('모든 품목에 동이 있고 블록 계가 전부 맞는다', () => {
    const s = scan(HEUNGHWA);
    expect(s.rows.filter(r => r.kind === 'item' && !r.location_dong)).toHaveLength(0);
    expect(s.blocks.every(b => b.declared_quantity === b.actual_quantity)).toBe(true);
  });
});

describe.skipIf(!fs.existsSync(GYERYONG))('계룡건설 — 한 칸 위치 · 오른쪽 보조표', () => {
  it('101동6~10층1,2,3,4호 에서 동·층·라인을 읽는다', () => {
    const r = row(scan(GYERYONG), 14);
    expect(r.location_dong).toBe('101동');
    expect(r.location_floor).toBe('6~10층');
    expect(r.location_line).toBe('1,2,3,4호');
  });

  it('보조표의 숫자 열(기본)이 위치 끝에 붙지 않는다', () => {
    const s = scan(GYERYONG);
    expect(row(s, 14).location_text).toBe('거실 大');
    expect(row(s, 16).location_text).toBe('거실小,침실2,3');
    expect(row(s, 61).location_text).toBe('침실1');
  });

  it('위치 + 비고로 읽어도 위치 칸에 이미 든 비고를 두 번 붙이지 않는다', () => {
    const s = scan(GYERYONG, 'both');
    expect(row(s, 14).location_text).toBe('101동6~10층1,2,3,4호거실 大');
  });

  it('블록 계가 전부 맞는다', () => {
    const s = scan(GYERYONG);
    expect(s.blocks.every(b => b.declared_quantity === b.actual_quantity)).toBe(true);
  });
});

describe('라인 여럿 표기', () => {
  it('1,3호 를 쪼개서 합친다', () => {
    expect(formatUnitRange(['1,3호', '2호'])).toBe('1~3호');
    expect(formatUnitRange(['1,3호'])).toBe('1,3호');
  });
});
