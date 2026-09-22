/**
 * 규격정리 엔진 — 발주 품목을 묶음(작업의뢰서 단위)별로 합산·정렬·위치 접기.
 *
 * 실제 ERP 작업의뢰서(우미 남원주 7차 9장 등)로 검증한 규칙:
 *   1 합산     품명 + 가로 + 세로가 같으면 수량을 더한다 (방이 달라도)
 *   2 정렬     품명 블록 순서 유지 → 세로 내림차순 → 가로 내림차순
 *   3 호 접기   3개 이상 연속이면 1~3호, 아니면 4,5호 / 1,3호  (라인도 같다)
 *   4 타입·방   84A+84B → 84A,B · 주방/식당+드레스룸 → 주방/식당,드레스룸
 *   5 검산     복층은 外·內가 짝 — 한쪽만 있으면 경고
 *
 * 묶음은 사람이 정한다. 이 모듈은 문장을 해석하지 않는다.
 * 어떤 양식이든 "품목 줄 → 단위(동·호 / 라인 / 층 / 시트 …) → 묶음" 으로 같은 그릇에 담는다.
 */

export const JAE_M2 = 0.303 * 0.303; // 1才 = 0.091809 ㎡

/** 발주 품목 한 줄 — 양식에 따라 있는 항목만 채워진다 */
export interface OrderLine {
  row: number;          // 엑셀 행 번호 (원본 추적용)
  sheet?: string;       // 시트 이름 (시트가 곧 단위인 양식용)
  product: string;
  w: number;
  h: number;
  qty: number;
  rawLoc: string;       // 고객이 적은 위치 문장 그대로
  dong?: number;
  ho?: number;
  line?: number;
  floor?: string;       // 31~35F, 21~24층
  type?: string;        // 84A
  room?: string;        // 거실F(外)
  zone?: string;        // 1BL-2, 구역 이름
}

/** 묶음을 자르는 단위 */
export type UnitKind = 'dong-ho' | 'dong-line' | 'dong' | 'floor' | 'zone' | 'sheet' | 'all';

export const UNIT_LABEL: Record<UnitKind, string> = {
  'dong-ho': '동·호', 'dong-line': '동·라인', dong: '동', floor: '층', zone: '구역', sheet: '시트', all: '전체',
};

/** 묶음 하나 = 작업의뢰서 한 장. units 는 unitOf() 가 돌려주는 문자열 목록 */
export interface Bundle {
  id: string;           // G1
  units: string[];
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
  name: string;             // "1동 1~3호" 처럼 사람이 읽는 이름
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
  if (s.length === 0) return '';
  if (s.length === 1) return String(s[0]);
  const seq = s.length >= 3 && s.every((n, i) => i === 0 || n === s[i - 1] + 1);
  return seq ? `${s[0]}~${s[s.length - 1]}` : s.join(',');
}

/** 84A, 84B → "84A,B" */
export function foldTypes(types: string[]): string {
  const s = [...new Set(types.filter(Boolean))].sort();
  if (s.length <= 1) return s[0] ?? '';
  const base = s[0].replace(/[A-Z]+$/, '');
  return s.every(t => t.startsWith(base)) ? base + s.map(t => t.slice(base.length)).join(',') : s.join(',');
}

/** "주방/식당(外)" + "드레스룸(外)" → "주방/식당,드레스룸(外)" */
export function foldRooms(rooms: string[]): string {
  const rs = rooms.filter(Boolean);
  if (rs.length === 0) return '';
  const suffix = (rs[0].match(/\((外|內)\)$/) || [''])[0];
  const names: string[] = [];
  for (const r of rs) {
    for (const n of r.replace(/\((外|內)\)$/, '').split(',')) {
      const t = n.trim();
      if (t && !names.includes(t)) names.push(t);
    }
  }
  return names.join(',') + suffix;
}

/** 가장 많이 나온 값 — 고객 파일의 자동채우기 오류(31~36F, 31~37F…)를 걸러낸다 */
export function mode<T>(values: T[]): T | undefined {
  const count = new Map<T, number>();
  for (const v of values) if (v !== undefined && v !== '') count.set(v, (count.get(v) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** 줄이 어느 단위에 속하는지 — 단위 종류에 따라 문자열 열쇠를 만든다 */
export function unitOf(line: OrderLine, kind: UnitKind): string {
  switch (kind) {
    case 'dong-ho':   return line.dong !== undefined ? `${line.dong}동 ${line.ho ?? '?'}호` : '미상';
    case 'dong-line': return line.dong !== undefined ? `${line.dong}동 ${line.line ?? '?'}라인` : '미상';
    case 'dong':      return line.dong !== undefined ? `${line.dong}동` : '미상';
    case 'floor':     return line.floor ?? '미상';
    case 'zone':      return line.zone ?? '미상';
    case 'sheet':     return line.sheet ?? '미상';
    case 'all':       return '전체';
  }
}

/** 이 줄들에서 쓸 수 있는 단위 종류 — 값이 실제로 있는 것만 */
export function availableKinds(lines: OrderLine[]): UnitKind[] {
  const has = (f: (l: OrderLine) => boolean) => lines.some(f);
  const kinds: UnitKind[] = [];
  if (has(l => l.dong !== undefined && l.ho !== undefined)) kinds.push('dong-ho');
  if (has(l => l.dong !== undefined && l.line !== undefined)) kinds.push('dong-line');
  if (has(l => l.dong !== undefined)) kinds.push('dong');
  if (has(l => !!l.floor)) kinds.push('floor');
  if (has(l => !!l.zone)) kinds.push('zone');
  if (new Set(lines.map(l => l.sheet).filter(Boolean)).size > 1) kinds.push('sheet');
  kinds.push('all');
  return kinds;
}

/** 단위 목록 (등장 순서, 자연 정렬) */
export function unitsOf(lines: OrderLine[], kind: UnitKind): string[] {
  const seen = new Set<string>();
  for (const l of lines) seen.add(unitOf(l, kind));
  const num = (s: string) => s.match(/\d+/g)?.map(Number) ?? [];
  return [...seen].sort((a, b) => {
    const na = num(a), nb = num(b);
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      const d = (na[i] ?? 0) - (nb[i] ?? 0);
      if (d) return d;
    }
    return a.localeCompare(b);
  });
}

/** 기본 묶음 제안 — 동·호/동·라인이면 동마다 하나, 그 밖에는 단위마다 하나 */
export function suggestBundles(lines: OrderLine[], kind: UnitKind): Bundle[] {
  const units = unitsOf(lines, kind);
  let groups: string[][];
  if (kind === 'dong-ho' || kind === 'dong-line') {
    const byDong = new Map<string, string[]>();
    for (const u of units) {
      const d = u.split(' ')[0];
      if (!byDong.has(d)) byDong.set(d, []);
      byDong.get(d)!.push(u);
    }
    groups = [...byDong.values()];
  } else {
    groups = units.map(u => [u]);
  }
  return groups.map((units, i) => ({ id: `G${i + 1}`, units }));
}

/** "1:1,2,3|4,5;2:1,2" (동:호 묶음) → 동·호 단위 묶음 */
export function parseBundleSpec(spec: string): Bundle[] {
  const out: Bundle[] = [];
  for (const part of spec.split(';').map(s => s.trim()).filter(Boolean)) {
    const [dongText, groups] = part.split(':');
    const dong = parseInt(dongText, 10);
    if (!Number.isFinite(dong) || !groups) continue;
    for (const g of groups.split('|')) {
      const hos = g.split(',').map(x => parseInt(x.trim(), 10)).filter(n => Number.isFinite(n));
      if (hos.length) out.push({ id: '', units: hos.map(h => `${dong}동 ${h}호`) });
    }
  }
  return out.map((b, i) => ({ ...b, id: `G${i + 1}` }));
}

/** 묶음 이름 — "1동 1~3호", "21~24층", "59A타입(1라인)" */
export function bundleName(bundle: Bundle, kind: UnitKind): string {
  const u = bundle.units;
  if (u.length === 0) return '(비어 있음)';
  if (kind === 'dong-ho' || kind === 'dong-line') {
    const byDong = new Map<string, number[]>();
    for (const x of u) {
      const m = x.match(/^(\d+)동 (\d+|\?)(호|라인)$/);
      if (!m) continue;
      if (!byDong.has(m[1])) byDong.set(m[1], []);
      if (m[2] !== '?') byDong.get(m[1])!.push(+m[2]);
    }
    const suffix = kind === 'dong-ho' ? '호' : '라인';
    return [...byDong.entries()].map(([d, ns]) => `${d}동 ${foldNums(ns)}${suffix}`).join(' + ');
  }
  return u.length <= 3 ? u.join(' + ') : `${u[0]} 외 ${u.length - 1}`;
}

export function bundleOf(line: OrderLine, bundles: Bundle[], kind: UnitKind): Bundle | undefined {
  const u = unitOf(line, kind);
  return bundles.find(b => b.units.includes(u));
}

/** 정리본 한 줄의 위치 문구 — 있는 항목만으로 만든다 */
function foldLocation(group: { dong?: number; hos: number[]; lines: number[]; types: string[]; floors: string[]; rooms: string[]; raws: string[]; zones: string[] }): string {
  const parts: string[] = [];
  if (group.zones.length) parts.push([...new Set(group.zones)].join(','));
  if (group.dong !== undefined) parts.push(`${group.dong}동`);
  if (group.hos.length) parts.push(`${foldNums(group.hos)}호`);
  if (group.lines.length) parts.push(`${foldNums(group.lines)}라인`);
  const t = foldTypes(group.types); if (t) parts.push(t);
  const f = mode(group.floors); if (f) parts.push(f);
  const r = foldRooms(group.rooms); if (r) parts.push(r);
  if (parts.length) return parts.join(' ');
  // 구조가 전혀 없으면 원문을 겹치지 않게 이어 붙인다
  return [...new Set(group.raws.filter(Boolean))].join(', ');
}

/** 묶음 하나를 규격정리 블록으로 */
export function organizeBundle(lines: OrderLine[], bundle: Bundle, kind: UnitKind): OrganizedBundle {
  const mine = lines.filter(l => bundle.units.includes(unitOf(l, kind)));

  type Group = { w: number; h: number; qty: number; dong?: number; hos: number[]; lines: number[]; types: string[]; floors: string[]; rooms: string[]; raws: string[]; zones: string[]; n: number };
  const byProduct = new Map<string, { left: OrderLine[]; groups: Map<string, Group> }>();

  for (const it of mine) {
    if (!byProduct.has(it.product)) byProduct.set(it.product, { left: [], groups: new Map() });
    const blk = byProduct.get(it.product)!;
    blk.left.push(it);
    const key = `${it.w}|${it.h}`;
    if (!blk.groups.has(key)) blk.groups.set(key, { w: it.w, h: it.h, qty: 0, dong: it.dong, hos: [], lines: [], types: [], floors: [], rooms: [], raws: [], zones: [], n: 0 });
    const g = blk.groups.get(key)!;
    g.qty += it.qty; g.n++;
    if (it.ho !== undefined) g.hos.push(it.ho);
    if (it.line !== undefined) g.lines.push(it.line);
    if (it.type) g.types.push(it.type);
    if (it.floor) g.floors.push(it.floor);
    if (it.room) g.rooms.push(it.room);
    if (it.zone) g.zones.push(it.zone);
    g.raws.push(it.rawLoc);
    if (g.dong !== it.dong) g.dong = undefined;   // 동이 섞이면 동 표기는 뺀다
  }

  const blocks: ProductBlock[] = [...byProduct.entries()].map(([product, blk]) => {
    const right: OrganizedRow[] = [...blk.groups.values()].map(g => ({
      loc: foldLocation(g), w: g.w, h: g.h, qty: g.qty,
      jae: areaJae(g.w, g.h, g.qty), m2: areaM2(g.w, g.h, g.qty), sourceCount: g.n,
    }));
    right.sort((a, b) => b.h - a.h || b.w - a.w);
    return { product, left: blk.left, right };
  });

  return {
    bundle, name: bundleName(bundle, kind), lines: mine, blocks,
    totalQty: mine.reduce((s, l) => s + l.qty, 0),
    warnings: checkPairs(mine),
  };
}

/** 外/內 짝 검산 — 방 이름에 (外)/(內) 표기가 있는 양식에서만 뜻이 있다 */
export function checkPairs(lines: OrderLine[]): string[] {
  const tagged = lines.filter(l => l.room && /\((外|內)\)$/.test(l.room));
  if (tagged.length === 0) return [];
  const key = (it: OrderLine) => `${it.dong ?? '?'}동 ${it.ho ?? it.line ?? '?'}호 ${it.w}x${it.h} ${it.room!.replace(/\((外|內)\)$/, '')}`;
  const outer = new Map(tagged.filter(l => /\(外\)$/.test(l.room!)).map(l => [key(l), l]));
  const inner = new Map(tagged.filter(l => /\(內\)$/.test(l.room!)).map(l => [key(l), l]));
  const warns: string[] = [];
  for (const [k, it] of outer) if (!inner.has(k)) warns.push(`外에는 있는데 內가 없음 → ${k}  ${it.qty}매`);
  for (const [k, it] of inner) if (!outer.has(k)) warns.push(`內에는 있는데 外가 없음 → ${k}  ${it.qty}매`);
  return warns;
}

/** 전체 실행 */
export function organize(lines: OrderLine[], bundles: Bundle[], kind: UnitKind) {
  const results = bundles.map(b => organizeBundle(lines, b, kind));
  const unassigned = lines.filter(l => !bundleOf(l, bundles, kind));
  return { results, unassigned };
}
