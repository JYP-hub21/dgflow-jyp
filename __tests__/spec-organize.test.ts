import { describe, it, expect } from 'vitest';
import {
  organizeBundle, foldNums, foldTypes, foldRooms, parseBundleSpec, defaultBundles, checkPairs,
  type OrderLine,
} from '../lib/spec/organize';

/** 우미 남원주 7차 1동 1~3호를 축소한 시험 데이터 — 규칙 5개가 전부 걸리게 구성 */
function line(p: Partial<OrderLine> & Pick<OrderLine, 'dong' | 'ho' | 'type' | 'room' | 'w' | 'h' | 'qty'>): OrderLine {
  return { row: 0, product: '外품명', floor: '31~35F', rawLoc: '', ...p };
}
const L: OrderLine[] = [
  // 1호 84A
  line({ dong: 1, ho: 1, type: '84A', room: '거실F(外)', w: 1719, h: 1820, qty: 5 }),
  line({ dong: 1, ho: 1, type: '84A', room: '주방/식당(外)', w: 455, h: 950, qty: 10 }),
  line({ dong: 1, ho: 1, type: '84A', room: '드레스룸,팬트리(外)', w: 305, h: 950, qty: 20 }),
  // 2호 84B — 고객이 층을 31~36F 로 잘못 적음, 주방과 드레스룸을 이미 합쳐 적음
  line({ dong: 1, ho: 2, type: '84B', room: '거실F(外)', w: 1719, h: 1820, qty: 5, floor: '31~36F' }),
  line({ dong: 1, ho: 2, type: '84B', room: '주방/식당,드레스룸(外)', w: 455, h: 950, qty: 20 }),
  // 3호 84A
  line({ dong: 1, ho: 3, type: '84A', room: '거실F(外)', w: 1719, h: 1820, qty: 5 }),
  line({ dong: 1, ho: 3, type: '84A', room: '주방/식당(外)', w: 455, h: 950, qty: 10 }),
  line({ dong: 1, ho: 3, type: '84A', room: '드레스룸,팬트리(外)', w: 305, h: 950, qty: 20 }),
  // 內 블록 — 3호 거실F(內) 를 일부러 뺀다 (검산이 잡아야 함)
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

describe('묶음 지정', () => {
  it('문자열 형식을 읽는다', () => {
    const b = parseBundleSpec('1:1,2,3|4,5;2:1,2');
    expect(b.map(x => `${x.id} ${x.dong}:${x.ho.join(',')}`)).toEqual(['G1 1:1,2,3', 'G2 1:4,5', 'G3 2:1,2']);
  });
  it('기본 묶음은 동마다 하나', () => {
    expect(defaultBundles(L)).toEqual([{ id: 'G1', dong: 1, ho: [1, 2, 3] }]);
  });
});

describe('규격정리 — 1동 1~3호', () => {
  const r = organizeBundle(L, { id: 'G1', dong: 1, ho: [1, 2, 3] });
  const outer = r.blocks.find(b => b.product === '外품명')!;

  it('합산: 품명+가로+세로 같으면 한 줄, 수량은 더한다 (방이 달라도)', () => {
    const k = outer.right.find(x => x.w === 455)!;
    expect(k.qty).toBe(40);                       // 10 + 20 + 10
    expect(k.sourceCount).toBe(3);
  });
  it('정렬: 세로↓ 가로↓', () => {
    expect(outer.right.map(x => `${x.w}x${x.h}`)).toEqual(['1719x1820', '455x950', '305x950']);
  });
  it('위치 접기: 호·타입·방을 접고, 층은 최빈값', () => {
    expect(outer.right[0].loc).toBe('1동 1~3호 84A,B 31~35F 거실F(外)');          // 31~36F 오류는 걸러짐
    expect(outer.right[1].loc).toBe('1동 1~3호 84A,B 31~35F 주방/식당,드레스룸(外)');
    expect(outer.right[2].loc).toBe('1동 1,3호 84A 31~35F 드레스룸,팬트리(外)');   // 2호엔 없으니 1,3호
  });
  it('면적: 才와 ㎡', () => {
    expect(outer.right[0].m2).toBe(46.93);        // 1719×1820×15 / 1e6
    expect(outer.right[0].jae).toBe(511.16);      // ÷ 0.091809
  });
  it('검산: 外만 있고 內가 빠진 줄을 잡는다', () => {
    // 순서는 원본 줄 순서를 따르므로 내용만 비교한다
    expect(checkPairs(r.lines).sort()).toEqual([
      '外에는 있는데 內가 없음 → 1동 1호 305x950 드레스룸,팬트리  20매',
      '外에는 있는데 內가 없음 → 1동 1호 455x950 주방/식당  10매',
      '外에는 있는데 內가 없음 → 1동 2호 455x950 주방/식당,드레스룸  20매',
      '外에는 있는데 內가 없음 → 1동 3호 1719x1820 거실F  5매',
      '外에는 있는데 內가 없음 → 1동 3호 305x950 드레스룸,팬트리  20매',
      '外에는 있는데 內가 없음 → 1동 3호 455x950 주방/식당  10매',
    ].sort());
  });
  it('품명 블록 순서는 첫 등장 순서(外 → 內)', () => {
    expect(r.blocks.map(b => b.product)).toEqual(['外품명', '內품명']);
    expect(r.totalQty).toBe(105);                 // 5+10+20 + 5+20 + 5+10+20 + 5+5
  });
});
