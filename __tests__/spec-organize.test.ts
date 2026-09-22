import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  organizeBundle, organize, foldNums, foldTypes, foldRooms, parseBundleSpec, suggestBundles, unitsOf,
  availableKinds, bundleName, checkPairs, rangesToUnits, rowsToRanges, type OrderLine,
} from '../lib/spec/organize';
import { parseLocation, expandNums } from '../lib/spec/location';
import { detectOrder, readOrder } from '../lib/parser/detect';

/** 우미 남원주 7차 1동 1~3호를 축소한 시험 데이터 — 규칙 5개가 전부 걸리게 구성 */
function line(p: Partial<OrderLine> & Pick<OrderLine, 'dong' | 'ho' | 'type' | 'room' | 'w' | 'h' | 'qty'>): OrderLine {
  return { row: 0, product: '外품명', floor: '31~35F', rawLoc: '', ...p };
}
const L: OrderLine[] = [
  line({ dong: 1, ho: 1, type: '84A', room: '거실F(外)', w: 1719, h: 1820, qty: 5 }),
  line({ dong: 1, ho: 1, type: '84A', room: '주방/식당(外)', w: 455, h: 950, qty: 10 }),
  line({ dong: 1, ho: 1, type: '84A', room: '드레스룸,팬트리(外)', w: 305, h: 950, qty: 20 }),
  line({ dong: 1, ho: 2, type: '84B', room: '거실F(外)', w: 1719, h: 1820, qty: 5, floor: '31~36F' }),   // 고객 자동채우기 오류
  line({ dong: 1, ho: 2, type: '84B', room: '주방/식당,드레스룸(外)', w: 455, h: 950, qty: 20 }),
  line({ dong: 1, ho: 3, type: '84A', room: '거실F(外)', w: 1719, h: 1820, qty: 5 }),
  line({ dong: 1, ho: 3, type: '84A', room: '주방/식당(外)', w: 455, h: 950, qty: 10 }),
  line({ dong: 1, ho: 3, type: '84A', room: '드레스룸,팬트리(外)', w: 305, h: 950, qty: 20 }),
  line({ product: '內품명', dong: 1, ho: 1, type: '84A', room: '거실F(內)', w: 1719, h: 1820, qty: 5 }),
  line({ product: '內품명', dong: 1, ho: 2, type: '84B', room: '거실F(內)', w: 1719, h: 1820, qty: 5 }),
];

describe('접기 규칙', () => {
  it('호: 3개 이상 연속이면 물결, 아니면 쉼표', () => {
    expect(foldNums([1, 2, 3])).toBe('1~3');
    expect(foldNums([4, 5])).toBe('4,5');
    expect(foldNums([1, 3])).toBe('1,3');
    expect(foldNums([2, 2, 2])).toBe('2');
  });
  it('타입: 84A,84B → 84A,B', () => {
    expect(foldTypes(['84A', '84B', '84A'])).toBe('84A,B');
    expect(foldTypes(['84A'])).toBe('84A');
  });
  it('방: 꼬리표를 떼고 합친 뒤 다시 붙인다', () => {
    expect(foldRooms(['주방/식당(外)', '드레스룸(外)'])).toBe('주방/식당,드레스룸(外)');
    expect(foldRooms(['주방/식당(外)', '주방/식당,드레스룸(外)'])).toBe('주방/식당,드레스룸(外)');
    expect(foldRooms(['발코니1'])).toBe('발코니1');
  });
});

describe('위치 문장 파서', () => {
  it('숫자 범위·목록·점 표기', () => {
    expect(expandNums('1,2,3')).toEqual([1, 2, 3]);
    expect(expandNums('3호~6호')).toEqual([3, 4, 5, 6]);
    expect(expandNums('4.5')).toEqual([4, 5]);
    expect(expandNums('1~2')).toEqual([1, 2]);
  });
  it('양식별 위치 문장', () => {
    expect(parseLocation('1동 1호 84A 31~35F 거실F(外)')).toMatchObject({ dong: 1, ho: [1], type: '84A', floor: '31~35층', rest: '거실F 外' });
    expect(parseLocation('84A(2동 4.5라인) 21~22층 거실 外,大')).toMatchObject({ dong: 2, line: [4, 5], type: '84A', floor: '21~22층' });
    expect(parseLocation('9동 3호~6호')).toMatchObject({ dong: 9, ho: [3, 4, 5, 6] });
    expect(parseLocation('6동 1,7 라인 55E 거실 외창-FIX [ 11~14F ]')).toMatchObject({ dong: 6, line: [1, 7], type: '55E', floor: '11~14층' });
    expect(parseLocation('301동 1~2라인 59A 글레이징')).toMatchObject({ dong: 301, line: [1, 2], type: '59A', rest: '글레이징' });
    expect(parseLocation('2동 84AL 타입 3~17층 침실 1 (외창)')).toMatchObject({ dong: 2, type: '84AL', floor: '3~17층' });
    expect(parseLocation('1BL-2 2층 복도')).toMatchObject({ zone: '1BL-2', floor: '2층', rest: '복도' });
    expect(parseLocation('구조마감/11층 남측 ACW-8')).toMatchObject({ floor: '11층' });
    expect(parseLocation('1층 피트니스')).toMatchObject({ floor: '1층', rest: '피트니스' });
    expect(parseLocation('59A타입(1동 1라인) 21~24층')).toMatchObject({ dong: 1, line: [1], type: '59A', floor: '21~24층' });
  });
});

describe('단위와 묶음', () => {
  it('쓸 수 있는 단위와 단위 목록', () => {
    expect(availableKinds(L)).toEqual(['rows', 'dong-ho', 'dong', 'floor', 'all']);   // 행 범위는 항상, 층 정보가 있으니 층도
    expect(unitsOf(L, 'dong-ho')).toEqual(['1동 1호', '1동 2호', '1동 3호']);
  });
  it('기본 제안은 동마다 하나, 문자열 형식도 읽는다', () => {
    expect(suggestBundles(L, 'dong-ho')).toEqual([{ id: 'G1', units: ['1동 1호', '1동 2호', '1동 3호'] }]);
    const b = parseBundleSpec('1:1,2,3|4,5;2:1,2');
    expect(b.map(x => `${x.id} ${x.units.join('/')}`)).toEqual(['G1 1동 1호/1동 2호/1동 3호', 'G2 1동 4호/1동 5호', 'G3 2동 1호/2동 2호']);
    expect(bundleName(b[0], 'dong-ho')).toBe('1동 1~3호');
    expect(bundleName(b[1], 'dong-ho')).toBe('1동 4,5호');
  });
});

describe('규격정리 — 1동 1~3호', () => {
  const r = organizeBundle(L, { id: 'G1', units: ['1동 1호', '1동 2호', '1동 3호'] }, 'dong-ho');
  const outer = r.blocks.find(b => b.product === '外품명')!;

  it('합산: 품명+가로+세로 같으면 한 줄, 수량은 더한다 (방이 달라도)', () => {
    const k = outer.right.find(x => x.w === 455)!;
    expect(k.qty).toBe(40);
    expect(k.sourceCount).toBe(3);
  });
  it('정렬: 세로↓ 가로↓', () => {
    expect(outer.right.map(x => `${x.w}x${x.h}`)).toEqual(['1719x1820', '455x950', '305x950']);
  });
  it('위치 접기: 호·타입·방을 접고, 층은 최빈값', () => {
    expect(outer.right[0].loc).toBe('1동 1~3호 84A,B 31~35F 거실F(外)');
    expect(outer.right[1].loc).toBe('1동 1~3호 84A,B 31~35F 주방/식당,드레스룸(外)');
    expect(outer.right[2].loc).toBe('1동 1,3호 84A 31~35F 드레스룸,팬트리(外)');
  });
  it('면적: 才와 ㎡', () => {
    expect(outer.right[0].m2).toBe(46.93);
    expect(outer.right[0].jae).toBe(511.16);
  });
  it('검산: 外만 있고 內가 빠진 줄을 잡는다', () => {
    expect(checkPairs(r.lines).sort()).toEqual([
      '外에는 있는데 內가 없음 → 1동 1호 305x950 드레스룸,팬트리  20매',
      '外에는 있는데 內가 없음 → 1동 1호 455x950 주방/식당  10매',
      '外에는 있는데 內가 없음 → 1동 2호 455x950 주방/식당,드레스룸  20매',
      '外에는 있는데 內가 없음 → 1동 3호 1719x1820 거실F  5매',
      '外에는 있는데 內가 없음 → 1동 3호 305x950 드레스룸,팬트리  20매',
      '外에는 있는데 內가 없음 → 1동 3호 455x950 주방/식당  10매',
    ].sort());
  });
  it('블록 순서는 첫 등장 순서, 이름과 합계', () => {
    expect(r.blocks.map(b => b.product)).toEqual(['外품명', '內품명']);
    expect(r.name).toBe('1동 1~3호');
    expect(r.totalQty).toBe(105);
  });
  it('미배정 줄을 알려 준다', () => {
    const { unassigned } = organize(L, [{ id: 'G1', units: ['1동 1호'] }], 'dong-ho');
    expect(unassigned.length).toBe(6);
  });
});

describe('행 범위로 묶기 (사용자 제안 방식)', () => {
  const lines: OrderLine[] = [
    { row: 15, sheet: '7차', product: 'A', w: 900, h: 1000, qty: 2, rawLoc: '1호' },
    { row: 16, sheet: '7차', product: 'A', w: 900, h: 1000, qty: 3, rawLoc: '1호' },
    { row: 18, sheet: '7차', product: 'A', w: 500, h: 700, qty: 1, rawLoc: '1호' },   // 17행은 빈 줄
    { row: 30, sheet: '7차', product: 'A', w: 900, h: 1000, qty: 4, rawLoc: '2호' },
    { row: 31, sheet: '7차', product: 'B', w: 900, h: 1000, qty: 1, rawLoc: '2호' },
    { row: 15, sheet: '8차', product: 'A', w: 900, h: 1000, qty: 9, rawLoc: '3호' },
  ];
  it('범위 글자 ↔ 행 단위', () => {
    expect(rangesToUnits('15~18', lines, '7차')).toEqual(['7차!15', '7차!16', '7차!18']);
    expect(rangesToUnits('15-16, 30~31행', lines, '7차')).toEqual(['7차!15', '7차!16', '7차!30', '7차!31']);
    expect(rangesToUnits('7차: 15~16 / 8차: 15', lines)).toEqual(['7차!15', '7차!16', '8차!15']);
    expect(rowsToRanges(['7차!15', '7차!16', '7차!18'])).toBe('15~16, 18행');
    expect(rowsToRanges(['7차!15', '7차!16', '7차!18'], lines)).toBe('15~18행');   // 17행은 품목이 없으니 이어진 것으로
    expect(rowsToRanges(['7차!15', '8차!15'])).toBe('7차: 15행 / 8차: 15행');
  });
  it('범위 안에서만 같은 품명·규격을 합친다', () => {
    const b = { id: 'G1', units: rangesToUnits('15~18', lines, '7차') };
    const r = organizeBundle(lines, b, 'rows');
    expect(r.name).toBe('15~18행');   // 17행은 품목이 없으니 사람 눈엔 15~18행
    expect(r.blocks[0].right.map(x => `${x.w}x${x.h}:${x.qty}`)).toEqual(['900x1000:5', '500x700:1']);   // 30행의 4매는 안 섞임
    expect(availableKinds(lines)[0]).toBe('rows');
    expect(suggestBundles(lines, 'rows')).toEqual([{ id: 'G1', units: ['7차!15', '7차!16', '7차!18', '7차!30', '7차!31', '8차!15'] }]);
  });
});

describe('구조가 없는 양식', () => {
  it('원문 위치를 이어 붙이고 시트 단위로 묶는다', () => {
    const lines: OrderLine[] = [
      { row: 1, sheet: '1층', product: '5T 투명', w: 900, h: 1000, qty: 2, rawLoc: '1층 피트니스', floor: '1층', room: '피트니스' },
      { row: 2, sheet: '1층', product: '5T 투명', w: 900, h: 1000, qty: 3, rawLoc: '1층 로비', floor: '1층', room: '로비' },
      { row: 3, sheet: '지하', product: '5T 투명', w: 900, h: 1000, qty: 1, rawLoc: '어린이집', room: '어린이집' },
    ];
    expect(availableKinds(lines)).toEqual(['rows', 'floor', 'sheet', 'all']);
    const r = organizeBundle(lines, { id: 'G1', units: ['1층'] }, 'sheet');
    expect(r.blocks[0].right[0]).toMatchObject({ qty: 5, loc: '1층 피트니스,로비' });
  });
});

describe('사내 양식 감지와 읽기', () => {
  it('시트 = 타입·라인, 품명 여러 줄, 소계로 블록 끝', () => {
    const wb = XLSX.utils.book_new();
    const rows: unknown[][] = Array.from({ length: 20 }, () => []);
    rows[2] = ['주문서 NO', '', '2026-001', '', '주문서 발송일', '', '2026-09-07'];
    rows[4] = ['현장명', '', '우미건설_부산장안', '', '내용', '', '59A타입(1동 1라인) 21~24층'];
    rows[7] = ['NO', '주    문    내    역', '', '', '', '', '', '', '', '', '㎡', '실란트', '위치', '비고'];
    rows[8] = ['', '외판/내판', '', '두께', '가로', '세로', '단위', '수 량', '개소', '합 계'];
    rows[9] = [1, '그린로이 복층유리', '', 22, 1542, 1797, 'EA', 1, 4, 4, 11.1, 53, '거실 외부 대창'];
    rows[10] = [2, '5GN,H/S+12A+5로이,H/S', '', '', 842, 1797, 'EA', 1, 4, 4, 6.1, 42, '거실 외부 소창'];
    rows[11] = [3, '일반간봉/실리콘/양면반강화', '', '', 620, 1839, 'EA', 2, 4, 8, 9.1, 79, '발코니1 외창'];
    rows[13] = [5, '소 계', '', '', '', '', '', '', '', 16];
    rows[14] = [6, '그린로이 복층유리', '', 22, 617, 963, 'EA', 2, 4, 8, 4.8, 51, '침1 외부창'];
    rows[15] = [7, '5GN+12A+5로이', '', '', 617, 963, 'EA', 2, 4, 8, 4.8, 51, '침2 외부창'];
    rows[17] = [9, '소 계', '', '', '', '', '', '', '', 16];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '59A타입(1라인)');
    const buf = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);

    const d = detectOrder(buf);
    expect(d.format).toBe('dongil');
    expect(d.sheets[0]).toMatchObject({ name: '59A타입(1라인)', lines: 5, note: '59A타입(1동 1라인) 21~24층' });

    const r = readOrder(buf, 'dongil', ['59A타입(1라인)']);
    expect(r.suggestedKind).toBe('sheet');
    expect(r.lines[0]).toMatchObject({ product: '그린로이 복층유리 / 5GN,H/S+12A+5로이,H/S / 일반간봉/실리콘/양면반강화', w: 1542, h: 1797, qty: 4, dong: 1, line: 1, type: '59A', floor: '21~24층' });
    expect(r.lines[3].product).toBe('그린로이 복층유리 / 5GN+12A+5로이');   // 두 번째 블록은 다른 품명
    expect(r.lines.reduce((s, l) => s + l.qty, 0)).toBe(32);
  });
});
