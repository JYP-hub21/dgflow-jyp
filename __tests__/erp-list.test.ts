import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { importPlan, parseErpOrderList, productNameOf, toIsoDate, toNumber } from '@/lib/work-order/erp-list';

/**
 * 지난 작업의뢰서 한꺼번에 가져오기 — ERP 작업의뢰서 목록 엑셀(한 줄 = 품목 하나).
 * 실물: 엑셀 자료/20260911 AX 업로드.xlsx (회사 파일, 저장소에 안 올림)
 */

describe('칸 값 읽기', () => {
  it('쉼표 · 빈칸 숫자, 여러 꼴의 날짜, 두께 붙인 품명', () => {
    expect(toNumber('1,326 ')).toBe(1326);
    expect(toNumber('')).toBeNull();
    expect(toIsoDate(new Date(2026, 0, 2))).toBe('2026-01-02');
    expect(toIsoDate('1/8/26')).toBe('2026-01-08');
    expect(toIsoDate('2026.1.9')).toBe('2026-01-09');
    expect(toIsoDate(46024)).toBe('2026-01-02');
    expect(productNameOf('5CL+12A+5로이', 22)).toBe('22T 5CL+12A+5로이');
    expect(productNameOf('24T 5CL+14Ar.+5로이', 24)).toBe('24T 5CL+14Ar.+5로이');
    expect(productNameOf('투명강화', 8)).toBe('8T 투명강화');
  });
});

describe('목록 → 의뢰번호별 작업의뢰서', () => {
  // 칸 순서를 섞고, 위에 제목 줄을 둔다 — 머리 이름으로 찾는지
  const rows: unknown[][] = [
    ['ERP 작업의뢰서 목록'],
    ['의뢰번호', 'NO', '품명', '두께', '가로규격', '세로규격', '주문수량', '출고수량', '잔여수량', '거래처', '현장명', '주문일자', '납품일자', '비고', '주문번호'],
    ['26-0101', 2, '5CL+12A+5로이', 22, '1,995 ', 454, 1, 1, '', '가나건설(주)', '가나 현장', '1/5/26', '1/13/26', '2층', '260105-05'],
    ['26-0101', 1, '5CL+12A+5로이', 22, 450, 1994, 2, 0, 2, '가나건설(주)', '가나 현장', '1/5/26', '1/13/26', '1층', '260105-05'],
    ['26-0102', 1, '투명강화', 8, 460, 454, 3, 3, '', '다라창호', '', '1/6/26', '', '', '260106-01'],
    ['26-0103', 1, '', 22, 300, 300, 1, 0, 1, '마바', '', '', '', '', ''],      // 품명 없음 — 건너뜀
    ['26-0104', 1, '5CL+12A+5로이', 22, 'abc', 300, 1, 0, 1, '마바', '', '', '', '', ''], // 규격이 숫자 아님
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const p = parseErpOrderList(rows);

  it('머리 줄을 찾고 의뢰번호별로 묶는다 — 의뢰서 안은 NO 순서', () => {
    expect(p.headerRow).toBe(2);
    expect(p.orders.map(o => [o.work_order_number, o.items.length])).toEqual([['26-0101', 2], ['26-0102', 1]]);
    const o = p.orders[0];
    expect(o.items.map(i => i.no)).toEqual([1, 2]);
    expect(o).toMatchObject({ customer: '가나건설(주)', site: '가나 현장', request_date: '2026-01-05', delivery_date: '2026-01-13', erp_order_number: '260105-05' });
    expect(o.items[0]).toMatchObject({ product_name: '22T 5CL+12A+5로이', width_mm: 450, height_mm: 1994, quantity: 2, shipped: 0, remaining: 2, remark: '1층' });
    // 잔여 칸이 비면 수량 - 출고
    expect(o.items[1].remaining).toBe(0);
    expect([o.quantity, o.shipped, o.remaining]).toEqual([3, 1, 2]);
  });

  it('면적은 ERP 규칙(장당 최소 0.28㎡)으로 계산한다', () => {
    // 460×454 는 장당 0.21㎡ 지만 최소 0.28㎡ 가 걸린다 → 3장 0.84㎡
    expect(p.orders[1].items[0].area_m2).toBe(0.84);
  });

  it('비었거나 숫자가 아닌 줄은 넣지 않고 알린다', () => {
    expect(p.skipped.map(s => s.row)).toEqual([6, 7]);
    expect(p.itemCount).toBe(3);
  });

  it('필수 칸이 없으면 무엇이 없는지 알린다', () => {
    const q = parseErpOrderList([['의뢰번호', '품명', '수량']]);
    // '수량' 은 주문수량 칸으로 알아본다 — 없는 것은 가로 · 세로뿐
    expect(q.missingColumns).toEqual(['가로규격', '세로규격']);
  });

  it('넣을 상태 — 다 나갔으면 완료, 잔여는 고른 대로', () => {
    const o = p.orders[0];
    expect(importPlan(o, { producedFromShipped: true, remainingStatus: 'active' })).toEqual({ produced: [0, 1], status: 'in_progress' });
    expect(importPlan(o, { producedFromShipped: true, remainingStatus: 'archive' }).status).toBe('completed');
    expect(importPlan(o, { producedFromShipped: false, remainingStatus: 'active' })).toEqual({ produced: [0, 0], status: 'pending' });
    expect(importPlan(p.orders[1], { producedFromShipped: true, remainingStatus: 'active' }).status).toBe('completed');
  });
});

const FIXTURE = path.join(process.cwd(), '엑셀 자료', '20260911 AX 업로드.xlsx');
describe.skipIf(!fs.existsSync(FIXTURE))('실물 — 20260911 AX 업로드.xlsx', () => {
  const wb = XLSX.readFile(FIXTURE, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  const p = parseErpOrderList(rows);

  it('작업의뢰서 399건 · 품목 5,180줄을 빠짐없이 읽는다', () => {
    expect(p.missingColumns).toEqual([]);
    expect(p.skipped).toEqual([]);
    expect(p.orders).toHaveLength(399);
    expect(p.itemCount).toBe(5180);
  });

  it('첫 의뢰서 26-0002 — 머리글 · 품명 · 날짜', () => {
    const o = p.orders.find(x => x.work_order_number === '26-0002')!;
    expect(o).toMatchObject({ customer: '(주)한일기업', request_date: '2026-01-02', delivery_date: '2026-01-08', erp_order_number: '260102-01' });
    expect(o.items).toHaveLength(14);
    expect(o.items[0]).toMatchObject({ no: 1, product_name: '24T 5SKN154IIh/s+14단열(Ar.)+5CL', width_mm: 476, height_mm: 768, quantity: 4, shipped: 4 });
  });
});
