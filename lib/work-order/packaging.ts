import { parsePackagingInstruction, formatUnitRange, type PackagingGroup } from './build';

export interface PackagingCandidate extends PackagingGroup {
  /** 이 포장 단위에 실제로 걸리는 품목 수 */
  item_count: number;
  /** 장수 합계 */
  quantity: number;
  /** 발주서 포장 지시문에서 나왔는지, 동·호 조합에서 추론했는지 */
  source: 'instruction' | 'derived';
  /** 이미 작업의뢰서가 만들어졌는지 */
  created: boolean;
}

interface ItemLocation {
  location_dong: string | null;
  location_line: string | null;
  quantity: number;
}

/**
 * 주문 품목에서 작업의뢰서 후보(포장 단위)를 뽑는다.
 *
 * 1순위는 발주서 상단의 포장 지시 문구다. 실제 업무가 그 단위로 포장·출고되기 때문이다.
 * 문구가 없거나 해석에 실패하면 품목에 들어 있는 동·호 조합을 그대로 후보로 내민다.
 */
export function buildPackagingCandidates(
  items: ItemLocation[],
  packagingNote: string | null,
  existingGroups: string[] = []
): PackagingCandidate[] {
  const created = new Set(existingGroups);
  const fromNote = parsePackagingInstruction(packagingNote ?? '');

  const candidates: PackagingCandidate[] =
    fromNote.length > 0
      ? fromNote.map(g => ({ ...g, ...tally(items, g), source: 'instruction' as const, created: created.has(g.label) }))
      : [];

  // 지시문에 없는 동·호가 남아 있으면 따로 후보로 올린다.
  // (지시문이 아예 없을 때는 이 경로만으로 전체 후보가 만들어진다.)
  const covered = new Set<string>();
  for (const g of candidates) {
    for (const u of g.units) covered.add(`${g.dong}|${u}`);
  }

  const leftovers = new Map<string, Set<string>>();
  for (const item of items) {
    const dong = item.location_dong;
    const unit = item.location_line;
    if (!dong || !unit || covered.has(`${dong}|${unit}`)) continue;
    if (!leftovers.has(dong)) leftovers.set(dong, new Set());
    leftovers.get(dong)!.add(unit);
  }

  for (const [dong, unitSet] of leftovers) {
    const units = [...unitSet].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const label = `${dong} ${formatUnitRange(units)}`;
    const group = { dong, units, label };
    candidates.push({ ...group, ...tally(items, group), source: 'derived', created: created.has(label) });
  }

  return candidates
    .filter(c => c.item_count > 0)
    .sort((a, b) => a.dong.localeCompare(b.dong, 'ko') || a.label.localeCompare(b.label, 'ko'));
}

function tally(items: ItemLocation[], group: PackagingGroup): { item_count: number; quantity: number } {
  const units = new Set(group.units);
  const matched = items.filter(
    i => i.location_dong === group.dong && i.location_line && units.has(i.location_line)
  );
  return {
    item_count: matched.length,
    quantity: matched.reduce((sum, i) => sum + (i.quantity || 0), 0),
  };
}
