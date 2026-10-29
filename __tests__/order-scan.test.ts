// @vitest-environment node
/**
 * 발주서 구조 스캔 테스트.
 *
 * 두 거래처의 실물 발주서가 **같은 양식**인데 위치를 적는 칸이 다르다.
 * 스캐너가 그 차이를 구조만 보고 알아내는지 확인한다.
 *
 *  - 우미건설 남원주 역세권1차 : 위치 열 사용, 소계 행 없음
 *  - KCC건설 여의도 오피스텔   : 위치 열이 비어 있고 비고 열 사용, 소계 행으로 포장 분리
 *
 * 검산 값(계 / 회색 합계 / 총계)은 발주서가 스스로 적어 둔 숫자라
 * 우리 계산과 반드시 일치해야 한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { scanOrderSheet } from '@/lib/parser/order-scan';

const KCC_FILE = path.join(process.cwd(), '엑셀 자료', 'KCC건설 여의도오피스텔 발주서.xlsx');
const UMI_FILE = path.join(process.cwd(), '발주서(우미건설-남원주 역세권1차) (11).xlsx');

const hasKcc = fs.existsSync(KCC_FILE);
const hasUmi = fs.existsSync(UMI_FILE);

function scan(file: string, sheet: string) {
  const wb = XLSX.readFile(file);
  return scanOrderSheet(wb.Sheets[sheet]);
}

describe.skipIf(!hasKcc)('KCC건설 여의도 오피스텔 — 비고 열이 위치인 양식', () => {
  it('헤더 행과 열을 찾는다', () => {
    const s = scan(KCC_FILE, '2026.09.17');
    expect(s.header_row).toBe(12);
    expect(s.columns.product_name).toBe(1);
    expect(s.columns.width_mm).toBe(3);
    expect(s.columns.height_mm).toBe(4);
    expect(s.columns.quantity).toBe(5);
    expect(s.columns.remark).toBe(8);
  });

  it('위치 열이 비어 있으므로 비고 열을 위치로 고른다', () => {
    const s = scan(KCC_FILE, '2026.09.17');
    expect(s.location_source).toBe('remark-column');
  });

  it('품명 칸 2번째 줄을 품명으로 오인하지 않는다', () => {
    const s = scan(KCC_FILE, '2026.09.17');
    const names = s.blocks.map(b => b.product_name);
    expect(names).toEqual([
      '5MVT172 H/S+ 14Ar + 5CL(근생)',
      '10CL T/P',
      '5MVT172 H/S+ 14Ar + 5CL',
      '5MVT172 H/S+ 14Ar + 5CL(스텝)',
    ]);
    expect(names).not.toContain('단열간봉/알곤/구조마감');
  });

  it('사양 줄의 구조마감을 위치 접두로 쓰지 않는다', () => {
    const s = scan(KCC_FILE, '2026.09.17');
    // 사양 줄(제품명 칸)에 `구조마감` 이 있어도 위치에는 끌어오지 않는다.
    // 그건 사원이 필요할 때 손으로 넣는 값이라 규칙이 없다.
    expect(s.blocks[0].spec_note).toContain('구조마감');
    expect(s.blocks[0].location_prefix).toBe('');
    expect(s.blocks[1].spec_note).toBe('');
    expect(s.blocks[1].location_prefix).toBe('');
    expect(s.blocks[3].location_prefix).toBe('');
  });

  it('위치 문자열을 발주서 비고 원문 그대로 만든다', () => {
    const s = scan(KCC_FILE, '2026.09.17');
    const items = s.rows.filter(r => r.kind === 'item');

    // 비고 열에 적힌 것이 전부다 — 앞뒤로 아무것도 덧붙이지 않는다.
    expect(items[0].location_text).toBe('근생//');
    expect(items.find(r => r.block_index === 1)!.location_text).toBe('근생/1층/32/AW');
    // 스텝 — 내판 폭이 원문에 들어 있어 따로 만들 필요가 없다
    expect(items.find(r => r.location_text.includes('우스텝-1'))!.location_text)
      .toBe('근생/1층/38/AW 우스텝-1W:920');
  });

  it('블록 계 행의 수량과 우리가 읽은 수량이 일치한다', () => {
    const s = scan(KCC_FILE, '2026.09.17');
    expect(s.blocks.map(b => b.declared_quantity)).toEqual([12, 44, 41, 6]);
    expect(s.blocks.map(b => b.actual_quantity)).toEqual([12, 44, 41, 6]);
  });

  it('회색 합계 행으로 포장 2개를 나눈다', () => {
    const s = scan(KCC_FILE, '2026.09.17');
    expect(s.packages).toHaveLength(2);
    expect(s.packages.map(p => p.declared_quantity)).toEqual([56, 47]);
    expect(s.packages.map(p => p.actual_quantity)).toEqual([56, 47]);
    expect(s.packages[0].block_indexes).toEqual([0, 1]);
    expect(s.packages[1].block_indexes).toEqual([2, 3]);
  });

  it('총계와 실제 합이 일치한다', () => {
    const s = scan(KCC_FILE, '2026.09.17');
    expect(s.declared_total).toBe(103);
    expect(s.actual_total).toBe(103);
  });

  it('포장 라벨이 적힌 시트는 라벨을 읽는다', () => {
    const s = scan(KCC_FILE, '2026.08.31(근생발주)');
    expect(s.packages.map(p => p.label)).toEqual(['A-구간', 'B-구간', 'C-구간']);
  });

  it('23개 시트 모두 검산이 맞는다', () => {
    const wb = XLSX.readFile(KCC_FILE);
    const failures: string[] = [];

    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) continue;
      const s = scanOrderSheet(ws);
      if (s.header_row === 0) continue;

      for (const b of s.blocks) {
        if (b.declared_quantity !== null && b.declared_quantity !== b.actual_quantity) {
          failures.push(`${name} 블록${b.index} 계 ${b.declared_quantity} ≠ ${b.actual_quantity}`);
        }
      }
      if (s.declared_total !== null && s.declared_total !== s.actual_total) {
        failures.push(`${name} 총계 ${s.declared_total} ≠ ${s.actual_total}`);
      }
    }

    expect(failures).toEqual([]);
  });
});

describe.skipIf(!hasUmi)('우미건설 남원주 역세권1차', () => {
  it('ERP 위치는 비고 열에서 읽는다', () => {
    const s = scan(UMI_FILE, '7차');
    expect(s.header_row).toBe(13);
    // ERP 업로드의 위치 칸은 거래처가 창 위치를 적는 `비 고` 열이 근거다.
    // 우미는 `위 치` 열에도 동·호를 적지만(46칸, 블록 머리만),
    // 모든 품목 행에 채워지는 쪽은 비고(321칸)다.
    expect(s.location_source).toBe('remark-column');
  });

  it('동·호·타입·층을 조립한다', () => {
    const s = scan(UMI_FILE, '7차');
    const first = s.rows.find(r => r.kind === 'item')!;
    expect(first.location_dong).toBe('1동');
    expect(first.location_line).toBe('1호');
    expect(first.location_type).toBe('84A');
    expect(first.location_floor).toBe('31~35F');
    expect(first.location_room).toBe('드레스룸,팬트리(外)');
  });

  it('계 행으로 블록이 끊기고 검산이 맞는다', () => {
    const s = scan(UMI_FILE, '7차');
    expect(s.blocks.length).toBeGreaterThan(10);

    const mismatched = s.blocks.filter(
      b => b.declared_quantity !== null && b.declared_quantity !== b.actual_quantity,
    );
    expect(mismatched).toEqual([]);
  });

  it('소계 행이 없으므로 포장은 한 덩어리로 남는다 (상단 지시문이 나눈다)', () => {
    const s = scan(UMI_FILE, '7차');
    expect(s.packages).toHaveLength(1);
    expect(s.declared_total).toBeNull();
  });
});
