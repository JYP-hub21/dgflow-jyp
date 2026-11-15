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

/** MES 품명 → 시스템 품명: 앞에 제품 두께를 붙인다 (이미 붙어 있으면 그대로) */
export function systemProductName(mesName: string): string {
  const name = mesName.trim();
  if (!name || /^\d+(?:\.\d+)?\s*T\s/i.test(name)) return name;
  const t = parseProductName(name).thickness;
  return t ? `${Math.round(t * 100) / 100}T ${name}` : name;
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

/** 생산 기록 한 줄의 면적 — 품목 면적을 수량 비율로 (작업의뢰서와 같은 규칙) */
export function logArea(item: Pick<MesOrderItem, 'width_mm' | 'height_mm' | 'quantity' | 'area_m2'>, qty: number): number {
  if (item.quantity > 0 && item.area_m2 > 0) return Math.round(item.area_m2 / item.quantity * qty * 100) / 100;
  return area(item.width_mm, item.height_mm, qty);
}
