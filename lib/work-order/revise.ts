/**
 * 작업의뢰서 수정 — 2026-11-06 회의: "이미 올린 의뢰서를 수정 · 삭제할 수 있어야 한다".
 *
 * 공사 쪽 변경으로 ERP 작업의뢰서가 바뀌면 의뢰번호는 그대로이고, 품목 일부가 없어지거나 수량이 바뀐다
 * (수량이 줄면 면적도 준다). 같은 번호를 다시 올리거나 화면에서 고치면 **바뀐 줄만** 적용한다.
 * 줄을 통째로 지우고 새로 넣으면 생산 기록이 함께 사라지므로, 품목을 짝지어 기록을 잇는다.
 *
 * 짝짓기: 품명 · 규격 · 비고가 같은 줄 → 품명 · 규격이 같은 줄 → 번호가 같은 줄. 번호는 줄이 빠지면 밀릴 수 있어 마지막에 본다.
 *
 * 이미 생산 · 납품한 품목을 지키는 규칙:
 *  · 문서에서 빠졌는데 생산 또는 납품 기록이 있으면 지우지 않고 수량을 그만큼으로 줄인다 — 기록이 남고 잔여는 0 이 된다.
 *  · 수량이 생산량 · 납품량보다 적어지면 그만큼까지만 줄인다 (기록을 건드리지 않는다).
 * 납품도 지킨다 (2026-11-10 점검): 품목 줄을 지우면 납품 기록이 CASCADE 로 함께 지워진다. 외주 · 재고로 나가
 * 생산 기록 없이 납품만 있는 줄이 수정 한 번에 조용히 사라졌다. 납품량은 의뢰 수량까지만 센다 — 재고분이 더 나갔다고
 * 의뢰 수량을 늘리지 않는다.
 */

export interface RevisionInput {
  /** 종이 작업의뢰서의 NO */
  no?: number;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  area_m2: number | null;
  remark: string | null;
}

export interface ExistingItem {
  id: string;
  item_no: number | null;
  sort_order: number;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  area_m2: number | null;
  remark: string | null;
  produced_quantity: number;
  /** 이 품목의 납품 합 — 부르는 쪽이 납품 기록에서 채운다 (lib/production/delivery-store.ts loadDeliveredByItem). 없으면 0 */
  delivered_quantity?: number;
}

/** 저장할 칸 */
export interface ItemFields {
  item_no: number;
  sort_order: number;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  area_m2: number | null;
  remark: string | null;
}

export interface ChangedItem {
  id: string;
  no: number;
  product_name: string;
  before: { width_mm: number; height_mm: number; quantity: number; remark: string | null };
  after: { width_mm: number; height_mm: number; quantity: number; remark: string | null };
  /** 이미 만든 수량 */
  produced: number;
  /** 이미 나간 수량 (의뢰 수량까지만 센다) */
  delivered: number;
  /** 문서 수량이 생산량 · 납품량보다 적어 그만큼까지만 줄였다 */
  limited: boolean;
}

export interface RemovedItem {
  id: string;
  no: number;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  produced: number;
  /** 이미 나간 수량 (의뢰 수량까지만 센다) */
  delivered: number;
  /** 생산 · 납품 기록이 있어 지우지 않고 수량만 줄인다 */
  kept: boolean;
  /** 지우지 않을 때 줄인 뒤의 수량 — 생산량 · 납품량 중 큰 것 */
  kept_quantity: number;
}

export interface RevisionPlan {
  same: number;
  changed: ChangedItem[];
  added: ItemFields[];
  removed: RemovedItem[];
  /** 저장할 내용 — 화면에 보이는 변경 외에 번호 · 순서만 바뀐 줄까지 */
  updates: { id: string; fields: Partial<ItemFields> }[];
  deletes: string[];
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const sameArea = (a: number | null, b: number | null) => Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.005;
const noOf = (e: ExistingItem, i: number) => e.item_no ?? i + 1;
/** 납품량 — 의뢰 수량까지만 (재고분이 더 나갔다고 의뢰 수량을 늘리지 않는다) */
const deliveredOf = (e: ExistingItem) => Math.max(0, Math.min(e.delivered_quantity ?? 0, e.quantity));
/** 이 밑으로는 줄이지 않는다 — 이미 만든 수량과 이미 나간 수량 중 큰 것 */
const floorOf = (e: ExistingItem) => Math.max(e.produced_quantity, deliveredOf(e));

/** 지금 품목과 새 품목을 맞춰 무엇이 바뀌는지 계산한다 — 화면 미리보기와 저장이 같은 계획을 쓴다 */
export function planRevision(existing: ExistingItem[], incoming: RevisionInput[]): RevisionPlan {
  const ordered = [...existing].sort((a, b) => a.sort_order - b.sort_order);
  const free = new Set(ordered.map(e => e.id));
  const match = new Map<number, ExistingItem>();

  const pair = (keyOfExisting: (e: ExistingItem) => string, keyOfIncoming: (i: RevisionInput) => string) => {
    incoming.forEach((item, idx) => {
      if (match.has(idx)) return;
      const key = keyOfIncoming(item);
      const hit = ordered.find(e => free.has(e.id) && keyOfExisting(e) === key);
      if (hit) { match.set(idx, hit); free.delete(hit.id); }
    });
  };
  const size = (i: { product_name: string; width_mm: number; height_mm: number }) => `${norm(i.product_name)}|${i.width_mm}|${i.height_mm}`;
  pair(e => `${size(e)}|${norm(e.remark)}`, i => `${size(i)}|${norm(i.remark)}`);
  pair(size, size);
  pair(e => String(e.item_no ?? ''), i => String(i.no ?? ''));

  const plan: RevisionPlan = { same: 0, changed: [], added: [], removed: [], updates: [], deletes: [] };
  /** 문서에 쓰인 가장 큰 번호 — 빠졌지만 남기는 줄은 이 뒤 번호를 받는다 */
  let lastNo = 0;

  incoming.forEach((item, idx) => {
    const fields: ItemFields = {
      item_no: Number.isInteger(item.no) && item.no! > 0 ? item.no! : idx + 1,
      sort_order: idx,
      product_name: item.product_name.trim(),
      width_mm: item.width_mm,
      height_mm: item.height_mm,
      quantity: item.quantity,
      area_m2: item.area_m2,
      remark: item.remark?.trim() || null,
    };
    lastNo = Math.max(lastNo, fields.item_no);
    const old = match.get(idx);
    if (!old) { plan.added.push(fields); return; }

    // 이미 만든 수량 · 이미 나간 수량 밑으로는 줄이지 않는다
    const floor = floorOf(old);
    const limited = fields.quantity < floor;
    if (limited) {
      const perSheet = fields.quantity > 0 && fields.area_m2 !== null ? fields.area_m2 / fields.quantity : null;
      fields.quantity = floor;
      if (perSheet !== null) fields.area_m2 = Math.round(perSheet * fields.quantity * 100) / 100;
    }

    const shown = norm(old.product_name) !== norm(fields.product_name)
      || old.width_mm !== fields.width_mm || old.height_mm !== fields.height_mm
      || old.quantity !== fields.quantity || norm(old.remark) !== norm(fields.remark);
    const diff: Partial<ItemFields> = {};
    if (old.item_no !== fields.item_no) diff.item_no = fields.item_no;
    if (old.sort_order !== fields.sort_order) diff.sort_order = fields.sort_order;
    if (old.product_name !== fields.product_name) diff.product_name = fields.product_name;
    if (old.width_mm !== fields.width_mm) diff.width_mm = fields.width_mm;
    if (old.height_mm !== fields.height_mm) diff.height_mm = fields.height_mm;
    if (old.quantity !== fields.quantity) diff.quantity = fields.quantity;
    if (!sameArea(old.area_m2, fields.area_m2)) diff.area_m2 = fields.area_m2;
    if (norm(old.remark) !== norm(fields.remark)) diff.remark = fields.remark;
    if (Object.keys(diff).length > 0) plan.updates.push({ id: old.id, fields: diff });

    if (shown || limited) {
      plan.changed.push({
        id: old.id, no: fields.item_no, product_name: fields.product_name,
        before: { width_mm: old.width_mm, height_mm: old.height_mm, quantity: old.quantity, remark: old.remark },
        after: { width_mm: fields.width_mm, height_mm: fields.height_mm, quantity: fields.quantity, remark: fields.remark },
        produced: old.produced_quantity,
        delivered: deliveredOf(old),
        limited,
      });
    } else plan.same++;
  });

  // 문서에서 빠진 줄 — 생산 · 납품 기록이 없으면 지우고, 있으면 수량만 줄여 뒤로 보낸다
  // (지우면 납품 기록이 CASCADE 로 함께 사라진다 — 생산 없이 납품만 있는 외주 · 재고 줄도 남긴다, 2026-11-10 점검)
  //
  // 남기는 줄의 번호: 문서 마지막 번호 다음부터 새로 매긴다. 옛 번호를 그대로 두면 남은 줄이 문서대로 다시 매겨지면서
  // 같은 번호가 두 줄 생겼다(상세 화면에 'No 3' 이 둘, 2026-11-10 점검). 비워 두면(null) 화면이 sort_order + 1 로 대신
  // 매기는데, 문서 번호가 1 부터가 아닐 때(예: 3–7번) 또 겹칠 수 있다. 이 줄은 순서도 맨 뒤라 번호도 맨 뒤가 자연스럽다.
  let tail = incoming.length;
  ordered.forEach((e, i) => {
    if (!free.has(e.id)) return;
    const delivered = deliveredOf(e);
    const kept = e.produced_quantity > 0 || delivered > 0;
    const keptQuantity = kept ? floorOf(e) : 0;
    plan.removed.push({
      id: e.id, no: noOf(e, i), product_name: e.product_name, width_mm: e.width_mm, height_mm: e.height_mm,
      quantity: e.quantity, produced: e.produced_quantity, delivered, kept, kept_quantity: keptQuantity,
    });
    if (!kept) { plan.deletes.push(e.id); return; }
    const perSheet = e.quantity > 0 && e.area_m2 !== null ? Number(e.area_m2) / e.quantity : null;
    const itemNo = ++lastNo;
    plan.updates.push({
      id: e.id,
      fields: {
        ...(e.item_no !== itemNo ? { item_no: itemNo } : {}),
        quantity: keptQuantity,
        sort_order: tail++,
        ...(perSheet !== null ? { area_m2: Math.round(perSheet * keptQuantity * 100) / 100 } : {}),
      },
    });
  });

  return plan;
}

/** 품목 표가 비었거나 빈칸이 있는지 — 등록 · 수정이 같은 기준을 쓴다 */
export function invalidItems(items: RevisionInput[] | undefined): string | null {
  if (!items?.length) return '품목이 비어 있습니다.';
  const bad = items.find(i => !i.product_name?.trim() || !i.width_mm || !i.height_mm || !i.quantity);
  return bad ? '품명 · 규격 · 수량이 비어 있는 행이 있습니다.' : null;
}
