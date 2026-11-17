import { expectedArea } from '@/lib/work-order/verify';
import { parseProductName } from './bokcheung';
import { compareGroups, groupQty, type MesGroup, type MesShift } from './mes';

/**
 * MES 생산실적 → 지난 작업의뢰서 + 생산 기록 (2026-11-15).
 *
 * 사용자: "MES 파일만 보고 예전의 작업의뢰서 및 생산 완료된 것들을 다 우리 시스템에 한 번에 넣고 싶다 —
 *         지난 작업의뢰서 가져오기 기능은 이제 현재 만들고 있는 것들만. MES 는 이미 생산까지 완료된 놈들이라
 *         작업의뢰서까지 알아서 들어온 걸로, 다른 작업의뢰서처럼 잘 나오게".
 *
 * 의뢰번호 하나 = 작업의뢰서 한 장, NO 하나 = 품목 한 줄.
 *  - 품명은 MES 품명 앞에 제품 두께를 붙여 시스템 꼴("22T 5CL+12A+5로이")로.
 *  - 수량은 MES 장수(바코드 + 번호 사이 채움). ERP 의뢰 수량은 MES 에 없다 — 92% 품목이 같았다(2026 파일 대조).
 *  - 의뢰일은 첫 생산일, 납기는 비운다(MES 에 없다).
 *  - 생산 기록은 날짜 · 호기 · 주야간별로 — 작업의뢰서 상세 · 생산일지에 생산 이력이 보인다.
 *  - 상태는 '완료' — 이미 생산 · 출고가 끝난 의뢰서라서. 납품 대기로 두면 납품 화면 · 미납품 재고에 다 쏟아진다.
 *    MES 로는 출고(납품)를 기록하지 않는다(11/13 회의).
 */

export const MES_ORDER_NOTE = 'MES 생산실적으로 등록';

/** MES 생산실적으로 만든 의뢰서인가 — 메모로 가린다 */
export function isMesOrder(notes: string | null | undefined): boolean {
  return (notes ?? '').includes(MES_ORDER_NOTE);
}

/**
 * MES 에 한 장도 안 찍혀 빠진 NO — 1 부터 가장 큰 NO 사이의 빈 번호 (2026-11-16 사용자 "품목 누락은 데이터의 한계지만
 * 알아낼 수 있는 건 알아내야"). 규격 · 수량은 MES 에 없어 알 수 없다. 바코드 번호로 수량을 짐작해 보았으나
 * 품목끼리 바코드 번호가 이어지지 않아(2026 파일: 빠진 NO 14곳 중 1곳만 맞음) 번호만 알린다.
 */
export function missingNos(nos: number[]): number[] {
  const have = new Set(nos.filter(n => Number.isInteger(n) && n > 0));
  const max = Math.max(0, ...have);
  const out: number[] = [];
  for (let n = 1; n < max; n++) if (!have.has(n)) out.push(n);
  return out;
}

export interface MesOrderItem {
  no: number;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  area_m2: number;
  remark: string | null;
}

export interface MesOrderLog {
  no: number;
  date: string;
  line: number;
  shift: MesShift;
  quantity: number;
}

export interface MesOrder {
  work_order_number: string;
  customer: string | null;
  site: string | null;
  /** 첫 생산일 */
  request_date: string;
  last_date: string;
  items: MesOrderItem[];
  logs: MesOrderLog[];
}

/**
 * MES 품명 → 시스템 품명: 앞에 제품 두께를 붙인다 (이미 붙어 있으면 그대로).
 * 2026 파일을 ERP 목록의 두께 칸과 대조하니 2,362품목 중 2,318개가 맞았다. 틀린 것 중 가장 많은 꼴은
 * "5CL+14단열(Ar.)+로이h/s" 처럼 뒤 유리 두께가 빠진 품명(ERP 24T) — 빠진 유리 두께는 앞 유리와 같다고 본다.
 * 나머지(ERP 두께 칸이 8.76 · 5 처럼 품명과 안 맞는 것)는 ERP 쪽 입력 실수로 보여 따르지 않는다.
 */
export function systemProductName(mesName: string): string {
  const name = mesName.trim();
  if (!name || /^\d+(?:\.\d+)?\s*T\s/i.test(name)) return name;
  const t = parseProductName(name).thickness ?? thicknessFillingPanes(name);
  return t ? `${Math.round(t * 100) / 100}T ${name}` : name;
}

/** 유리 · 간봉 · 유리 품명에서 두께 숫자가 빠진 유리를 첫 유리 두께로 채워 합친다. 괄호 속 + 가 있으면 손대지 않는다 */
function thicknessFillingPanes(name: string): number | null {
  if (/\([^)]*\+/.test(name)) return null;
  const parts = name.split('+').map(p => p.trim());
  if (parts.length < 3 || parts.length % 2 === 0) return null;
  const num = (p: string) => p.match(/^\d+(?:\.\d+)?/)?.[0];
  const first = num(parts[0]);
  if (!first) return null;
  const nums = parts.map((p, i) => num(p) ?? (i % 2 === 0 ? first : undefined));
  return nums.every(Boolean) ? nums.reduce((s, n) => s + Number(n), 0) : null;
}

const area = (w: number, h: number, q: number) => (w > 0 && h > 0 ? expectedArea(w, h, q) : 0);

/** 묶음들 → 의뢰번호별 작업의뢰서 계획 (의뢰번호 순) */
export function planMesOrders(groups: MesGroup[]): MesOrder[] {
  const byWo = new Map<string, MesGroup[]>();
  for (const g of [...groups].sort(compareGroups)) {
    const list = byWo.get(g.wo);
    if (list) list.push(g); else byWo.set(g.wo, [g]);
  }
  const out: MesOrder[] = [];
  for (const [wo, list] of byWo) {
    const items = new Map<number, MesOrderItem>();
    for (const g of list) {
      const it = items.get(g.no);
      if (it) {
        it.quantity += groupQty(g);
        if (!it.remark && g.remark) it.remark = g.remark;
      } else {
        items.set(g.no, {
          no: g.no, product_name: systemProductName(g.product) || '(품명 없음)', width_mm: g.width, height_mm: g.height,
          quantity: groupQty(g), area_m2: 0, remark: g.remark || null,
        });
      }
    }
    for (const it of items.values()) it.area_m2 = area(it.width_mm, it.height_mm, it.quantity);
    const dates = list.map(g => g.date).sort();
    const named = list.find(g => g.customer || g.site);
    out.push({
      work_order_number: wo,
      customer: named?.customer || null,
      site: list.find(g => g.site)?.site || null,
      request_date: dates[0],
      last_date: dates[dates.length - 1],
      items: [...items.values()].sort((a, b) => a.no - b.no),
      logs: list.map(g => ({ no: g.no, date: g.date, line: g.line, shift: g.shift, quantity: groupQty(g) })),
    });
  }
  return out.sort((a, b) => a.work_order_number.localeCompare(b.work_order_number));
}

/** 지난번에 올린 MES 한 줄 — MES 실적 표(dgflow_mes_production)에서 읽는다 */
export interface MesSeenRow { no: number; date: string; line: number; shift: MesShift; quantity: number }

export interface MesReuploadPlan {
  /** 새 품목으로 더할 NO — 지난번에 없던 번호 */
  newNos: number[];
  /** 새로 붙일 생산 — 지난번에 없던 날 · 호기 · 주야간 */
  fresh: MesOrderLog[];
  /** 지난번과 장수가 달라진 줄 — delta 만큼만 더하거나 뺀다 */
  changed: (MesOrderLog & { delta: number })[];
  /** 지난번에 넣었는데 지금은 없는 NO — 사람이 지운 품목이라 다시 만들지 않는다 */
  removedNos: number[];
}

const seenKey = (l: { no: number; date: string; line: number; shift: MesShift }) => `${l.no}|${l.date}|${l.line}|${l.shift}`;

/**
 * MES 로 만든 작업의뢰서에 MES 파일을 다시 올릴 때 무엇을 바꿀지 (2026-11-17, 11/16 점검 P2).
 *
 * 예전에는 "그 품목 · 날 · 호기 · 주야간의 생산 기록이 없으면 넣는다" 만 보았다. 그래서 화면에서 수량을 줄여 지워진 기록,
 * 지운 품목이 다시 올릴 때마다 되살아났다. 이제 지난번에 올린 내용(seen — MES 실적 표)과 견주어 **달라진 것만** 넣는다:
 *  - 지난번에도 있던 줄(같은 NO · 날 · 호기 · 주야간)인데 장수가 같다 → 건드리지 않는다. 사람이 고친 것이 그대로 남는다.
 *  - 장수가 달라졌다(뒤늦게 올라온 바코드) → 달라진 만큼만 더하거나 뺀다.
 *  - 지난번에 없던 줄 → 새 생산으로 붙인다.
 *  - 지난번에 넣은 NO 가 지금 없다 → 사람이 지운 품목이다. 다시 만들지 않는다.
 *
 * MES 실적 표에는 올릴 때 고른 기간의 줄만 있고, 작업의뢰서는 기간 앞의 생산까지 통째로 넣는다.
 * 그래서 표에 없는 줄이라도 그 의뢰서의 표 첫 날보다 앞선 날짜면 그때 이미 넣은 것으로 본다.
 * seen 이 비어 있으면(표가 생기기 전에 만든 의뢰서) 견줄 것이 없다 — 전부 새 줄로 돌려주고, 넣는 쪽이 같은 날 · 호기 기록이 있으면 건너뛴다.
 */
export function planMesReupload(order: Pick<MesOrder, 'logs'>, seen: MesSeenRow[], currentNos: Iterable<number>): MesReuploadPlan {
  const have = new Set(currentNos);
  const seenQty = new Map(seen.map(r => [seenKey(r), r.quantity]));
  const firstSeen = seen.reduce<string | null>((m, r) => (m === null || r.date < m ? r.date : m), null);
  const known = new Set(seen.map(r => r.no));
  if (firstSeen) for (const l of order.logs) if (l.date < firstSeen) known.add(l.no);

  const newNos = new Set<number>(), removedNos = new Set<number>();
  const fresh: MesOrderLog[] = [];
  const changed: (MesOrderLog & { delta: number })[] = [];
  for (const l of order.logs) {
    if (!have.has(l.no)) {
      if (known.has(l.no)) { removedNos.add(l.no); continue; }
      newNos.add(l.no);
      fresh.push(l);
      continue;
    }
    const before = seenQty.get(seenKey(l));
    if (before !== undefined) {
      if (l.quantity !== before) changed.push({ ...l, delta: l.quantity - before });
      continue;
    }
    if (firstSeen && l.date < firstSeen) continue;
    fresh.push(l);
  }
  const asc = (a: number, b: number) => a - b;
  return { newNos: [...newNos].sort(asc), fresh, changed, removedNos: [...removedNos].sort(asc) };
}

/** 사람이 등록한 작업의뢰서(등록 화면 · 지난 의뢰서 가져오기)의 품목 하나 — MES 를 붙이기 전 상태 */
export interface OtherItemState {
  /** 의뢰 수량 */
  quantity: number;
  /** 생산 수량 — 품목에 저장된 값. 생산 기록 없이 수량만 있는 '출고만큼 생산'(지난 의뢰서 가져오기)도 들어 있다 */
  produced: number;
  /** 그 가운데 MES 가져오기가 넣은 생산 기록의 합 */
  mesQty: number;
  /** 이미 있는 생산 기록의 날 · 호기 · 주야간 (otherKey) */
  have: Set<string>;
}

export const otherKey = (l: { date: string; line: number; shift: MesShift }) => `${l.date}|${l.line}|${l.shift}`;

/**
 * 사람이 등록한 작업의뢰서에 MES 생산을 붙일 때 (2026-11-17, 11/16 점검 P3).
 *
 * 예전에는 "그 날 · 호기 · 주야간 기록이 없으면 넣는다" 만 보아, 생산관리부가 11/17 주간 1호기로 넣은 유리를
 * MES 가 11/16 이나 2호기 · 야간으로 찍었으면 또 넣었다 — 의뢰 40조에 생산 80조가 될 수 있었다.
 * 이제:
 *  - 손으로 넣은 생산이 있는 품목은 MES 로 더하지 않는다(손 입력이 먼저 — 생산일지와 같은 규칙).
 *    MES 가 넣은 기록만 있으면 손 입력이 아니다(MES 를 두 번 올린 경우).
 *  - 손 입력이 없는 품목은 MES 생산을 붙이되 의뢰 수량까지만. 넘는 장수(재작업 등)는 capped 로 센다.
 *  - 이미 있는 날 · 호기 · 주야간 줄은 건너뛴다(같은 파일을 다시 올렸거나 중간에 끊겨 다시 보낸 경우).
 */
export function planOtherOrderMes(item: OtherItemState, lines: MesOrderLog[]): { add: MesOrderLog[]; manual: boolean; capped: number } {
  if (item.produced - item.mesQty > 0) return { add: [], manual: true, capped: 0 };
  let room = Math.max(0, item.quantity - item.mesQty);
  const add: MesOrderLog[] = [];
  let capped = 0;
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line || (a.shift === b.shift ? 0 : a.shift === 'day' ? -1 : 1));
  for (const l of sorted) {
    if (item.have.has(otherKey(l))) continue;
    const take = Math.min(l.quantity, room);
    capped += l.quantity - take;
    if (take > 0) { add.push({ ...l, quantity: take }); room -= take; }
  }
  return { add, manual: false, capped };
}

/** 생산 기록 한 줄의 면적 — 품목 면적을 수량 비율로 (작업의뢰서와 같은 규칙) */
export function logArea(item: Pick<MesOrderItem, 'width_mm' | 'height_mm' | 'quantity' | 'area_m2'>, qty: number): number {
  if (item.quantity > 0 && item.area_m2 > 0) return Math.round(item.area_m2 / item.quantity * qty * 100) / 100;
  return area(item.width_mm, item.height_mm, qty);
}
