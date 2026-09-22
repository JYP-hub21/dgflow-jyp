/**
 * 규격정리 엔진 — 발주 품목을 묶음(작업의뢰서 단위)별로 합산·정렬·위치 접기.
 *
 * 실제 ERP 작업의뢰서 9장(우미 남원주 7차)으로 검증한 규칙:
 *   1 합산     품명 + 가로 + 세로가 같으면 수량을 더한다 (방이 달라도)
 *   2 정렬     품명 블록 순서 유지 → 세로 내림차순 → 가로 내림차순
 *   3 호 접기   3개 이상 연속이면 1~3호, 아니면 4,5호 / 1,3호
 *   4 타입·방   84A+84B → 84A,B · 주방/식당+드레스룸 → 주방/식당,드레스룸
 *   5 검산     복층은 外·內가 짝 — 한쪽만 있으면 경고
 *
 * 묶음은 사람이 정한다. 이 모듈은 문장을 해석하지 않는다.
 * scripts/spec-organize.py 와 같은 규칙이다.
 */

export const JAE_M2 = 0.303 * 0.303; // 1才 = 0.091809 ㎡

/** 우미(=KCC) 양식에서 읽은 발주 품목 한 줄 */
export interface OrderLine {
  row: number;          // 엑셀 행 번호 (원본 추적용)
  product: string;      // 품명 (블록 첫 줄 값을 아래로 채운 것)
  dong: number;
  ho: number;
  type: string;         // 84A
  floor: string;        // 31~35F
  room: string;         // 거실F(外)
  w: number;
  h: number;
  qty: number;
  rawLoc: string;       // 고객이 적은 위치 문장 그대로
}

/** 묶음 하나 = 작업의뢰서 한 장 */
export interface Bundle {
  id: string;           // G1
  dong: number;
  ho: number[];
}

export interface OrganizedRow {
  loc: string;
  w: number;
  h: number;
  qty: number;
  jae: number;
  m2: number;
  sourceCount: number;
}

export interface ProductBlock {
  product: string;
  left: OrderLine[];        // 원본 순서 그대로
  right: OrganizedRow[];    // 합산·정렬한 정리본
}

export interface OrganizedBundle {
  bundle: Bundle;
  lines: OrderLine[];
  blocks: ProductBlock[];
  totalQty: number;
  warnings: string[];
}

export const areaJae = (w: number, h: number, q: number) => Math.round((w * h * q) / 1_000_000 / JAE_M2 * 100) / 100;
export const areaM2 = (w: number, h: number, q: number) => Math.round((w * h * q) / 1_000_000 * 100) / 100;

/** 1,2,3 → "1~3" · 4,5 → "4,5" · 1,3 → "1,3" */
export function foldNums(nums: number[]): string {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  if (s.length === 1) return String(s[0]);
  const seq = s.length >= 3 && s.every((n, i) => i === 0 || n === s[i - 1] + 1);
  return seq ? `${s[0]}~${s[s.length - 1]}` : s.join(',');
}

/** 84A, 84B → "84A,B" */
export function foldTypes(types: string[]): string {
  const s = [...new Set(types)].sort();
  if (s.length === 1) return s[0];
  const base = s[0].replace(/[A-Z]+$/, '');
  return s.every(t => t.startsWith(base)) ? base + s.map(t => t.slice(base.length)).join(',') : s.join(',');
}

/** "주방/식당(外)" + "드레스룸(外)" → "주방/식당,드레스룸(外)" */
export function foldRooms(rooms: string[]): string {
  const suffix = (rooms[0].match(/\((外|內)\)$/) || [''])[0];
  const names: string[] = [];
  for (const r of rooms) {
    for (const n of r.replace(/\((外|內)\)$/, '').split(',')) {
      if (!names.includes(n)) names.push(n);
    }
  }
  return names.join(',') + suffix;
}

/** 가장 많이 나온 값 — 고객 파일의 자동채우기 오류(31~36F, 31~37F…)를 걸러낸다 */
export function mode<T>(values: T[]): T {
  const count = new Map<T, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** 발주서 안의 동·호 목록에서 기본 묶음을 제안한다 — 동마다 한 묶음 */
export function defaultBundles(lines: OrderLine[]): Bundle[] {
  const dongs = [...new Set(lines.map(l => l.dong))].sort((a, b) => a - b);
  return dongs.map((dong, i) => ({
    id: `G${i + 1}`,
    dong,
    ho: [...new Set(lines.filter(l => l.dong === dong).map(l => l.ho))].sort((a, b) => a - b),
  }));
}

/** "1:1,2,3|4,5;2:1,2|3,4,5" 형식을 묶음 목록으로 */
export function parseBundleSpec(spec: string): Bundle[] {
  const out: Bundle[] = [];
  for (const part of spec.split(';').map(s => s.trim()).filter(Boolean)) {
    const [dongText, groups] = part.split(':');
    const dong = parseInt(dongText, 10);
    if (!Number.isFinite(dong) || !groups) continue;
    for (const g of groups.split('|')) {
      const ho = g.split(',').map(x => parseInt(x.trim(), 10)).filter(n => Number.isFinite(n));
      if (ho.length) out.push({ id: '', dong, ho });
    }
  }
  return out.map((b, i) => ({ ...b, id: `G${i + 1}` }));
}

export function bundleOf(line: OrderLine, bundles: Bundle[]): Bundle | undefined {
  return bundles.find(b => b.dong === line.dong && b.ho.includes(line.ho));
}

/** 묶음 하나를 규격정리 블록으로 */
export function organizeBundle(lines: OrderLine[], bundle: Bundle): OrganizedBundle {
  const mine = lines.filter(l => l.dong === bundle.dong && bundle.ho.includes(l.ho));

  type Group = { w: number; h: number; qty: number; hos: number[]; types: string[]; rooms: string[]; floors: string[]; dong: number; n: number };
  const byProduct = new Map<string, { left: OrderLine[]; groups: Map<string, Group> }>();

  for (const it of mine) {
    if (!byProduct.has(it.product)) byProduct.set(it.product, { left: [], groups: new Map() });
    const blk = byProduct.get(it.product)!;
    blk.left.push(it);
    const key = `${it.w}|${it.h}`;
    if (!blk.groups.has(key)) blk.groups.set(key, { w: it.w, h: it.h, qty: 0, hos: [], types: [], rooms: [], floors: [], dong: it.dong, n: 0 });
    const g = blk.groups.get(key)!;
    g.qty += it.qty; g.hos.push(it.ho); g.types.push(it.type); g.rooms.push(it.room); g.floors.push(it.floor); g.n++;
  }

  const blocks: ProductBlock[] = [...byProduct.entries()].map(([product, blk]) => {
    const right: OrganizedRow[] = [...blk.groups.values()].map(g => ({
      loc: `${g.dong}동 ${foldNums(g.hos)}호 ${foldTypes(g.types)} ${mode(g.floors)} ${foldRooms(g.rooms)}`,
      w: g.w, h: g.h, qty: g.qty,
      jae: areaJae(g.w, g.h, g.qty), m2: areaM2(g.w, g.h, g.qty),
      sourceCount: g.n,
    }));
    right.sort((a, b) => b.h - a.h || b.w - a.w);
    return { product, left: blk.left, right };
  });

  return {
    bundle,
    lines: mine,
    blocks,
    totalQty: mine.reduce((s, l) => s + l.qty, 0),
    warnings: checkPairs(mine),
  };
}

/** 外/內 짝 검산 */
export function checkPairs(lines: OrderLine[]): string[] {
  const key = (it: OrderLine) => `${it.dong}동 ${it.ho}호 ${it.w}x${it.h} ${it.room.replace(/\((外|內)\)$/, '')}`;
  const outer = new Map(lines.filter(l => /\(外\)$/.test(l.room)).map(l => [key(l), l]));
  const inner = new Map(lines.filter(l => /\(內\)$/.test(l.room)).map(l => [key(l), l]));
  const warns: string[] = [];
  for (const [k, it] of outer) if (!inner.has(k)) warns.push(`外에는 있는데 內가 없음 → ${k}  ${it.qty}매`);
  for (const [k, it] of inner) if (!outer.has(k)) warns.push(`內에는 있는데 外가 없음 → ${k}  ${it.qty}매`);
  return warns;
}

/** 전체 실행 */
export function organize(lines: OrderLine[], bundles: Bundle[]) {
  const results = bundles.map(b => organizeBundle(lines, b));
  const unassigned = lines.filter(l => !bundleOf(l, bundles));
  return { results, unassigned };
}
