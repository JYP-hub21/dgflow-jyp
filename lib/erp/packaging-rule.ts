/**
 * 수동 포장 구성과 현장별 포장 규칙
 *
 * 발주서에 포장 단위가 명확히 적혀 있으면 자동으로 나눈다 (`from-scan.ts`, `packaging-note.ts`).
 * 하지만 작성자마다 적는 방식이 달라 알아보기 힘든 발주서가 계속 들어온다.
 * 그때는 사원이 직접 행을 골라 포장을 짜야 한다.
 *
 * ── 저장할 때의 함정 ───────────────────────────────────────
 * 짠 구성을 **발주서 행 번호로 저장하면 다음 차수에 못 쓴다.** 행이 밀리기 때문이다.
 * 그래서 저장할 때는 행 번호가 아니라 **무엇을 기준으로 묶었는지**를 뽑아낸다.
 *
 *   `3동 1,2,3호` 가 한 포장   → `{ kind: 'units', dong: '3동', units: [...] }`  ← 다음 차수에도 통한다
 *   품명 블록 단위로 묶임      → `{ kind: 'blocks', products: [...] }`           ← 통한다
 *   그 외                      → `{ kind: 'rows' }`                              ← 이번 파일 전용
 *
 * 기준을 못 뽑아내면 억지로 일반화하지 않고 "이 차수에서만 쓸 수 있습니다" 라고 알린다.
 * 잘못 일반화한 규칙이 다음 차수에 조용히 적용되면 포장이 통째로 뒤섞인다.
 */
import { formatUnitRange, type PackagingGroup, type WorkOrderSourceItem } from '@/lib/work-order/build';

/** 사원이 화면에서 짜고 있는 포장 하나 */
export interface ManualPackage {
  /** 화면 안에서만 쓰는 식별자 */
  id: string;
  label: string;
  /** 발주서 엑셀 행 번호 */
  rows: number[];
}

export type PackagingRuleGroup =
  /** 동·호로 묶었다 — 다음 차수에도 그대로 통한다 */
  | { kind: 'units'; label: string; dong: string; units: string[] }
  /** 품명 블록으로 묶었다 — 품명이 같으면 통한다 */
  | { kind: 'blocks'; label: string; products: string[] }
  /** 기준을 뽑아내지 못했다 — 이 파일에서만 쓸 수 있다 */
  | { kind: 'rows'; label: string; rows: number[] };

export interface PackagingRule {
  id?: string;
  name: string;
  site_hint: string | null;
  customer_hint: string | null;
  groups: PackagingRuleGroup[];
  /** 다음 차수에도 쓸 수 있는 규칙인지 */
  reusable: boolean;
  updated_at?: string;
}

let seq = 0;
export const newPackageId = () => `pkg-${Date.now()}-${++seq}`;

/** 수동 구성을 ERP 생성기가 쓰는 포장 단위로 바꾼다. */
export function toPackagingGroups(packages: ManualPackage[]): PackagingGroup[] {
  return packages
    .filter(p => p.rows.length > 0)
    .map((p, i) => ({
      dong: '',
      units: [],
      label: p.label.trim() || `포장 ${i + 1}`,
      row_keys: [...p.rows],
    }));
}

/**
 * 지금 화면에 떠 있는 자동 결과를 수동 편집의 출발점으로 삼는다.
 *
 * 빈 화면에서 시작하면 103행을 전부 손으로 배정해야 한다.
 * 자동이 80% 맞으면 틀린 것만 옮기면 되도록, 자동 결과를 복사해 놓고 시작한다.
 */
export function seedFromGroups(
  rows: WorkOrderSourceItem[],
  groups: PackagingGroup[],
  pick: (rows: WorkOrderSourceItem[], group: PackagingGroup) => WorkOrderSourceItem[],
): ManualPackage[] {
  if (groups.length === 0) {
    return [{ id: newPackageId(), label: '포장 1', rows: rowNumbers(rows) }];
  }
  return groups.map(g => ({
    id: newPackageId(),
    label: g.label,
    rows: rowNumbers(pick(rows, g)),
  }));
}

/** 어느 포장에도 들어가지 않은 행 — 절대 조용히 버리지 않는다 */
export function unassignedRows(
  rows: WorkOrderSourceItem[],
  packages: ManualPackage[],
): WorkOrderSourceItem[] {
  const taken = new Set(packages.flatMap(p => p.rows));
  return rows.filter(r => r.source_row !== undefined && !taken.has(r.source_row));
}

/**
 * 수동 구성에서 **재사용 가능한 기준**을 뽑아낸다.
 *
 * 동·호로 깔끔하게 갈리는지 먼저 보고, 안 되면 품명 블록인지 보고,
 * 그것도 아니면 행 번호로 남긴다(이 파일 전용).
 */
export function deriveRule(
  packages: ManualPackage[],
  rows: WorkOrderSourceItem[],
): { groups: PackagingRuleGroup[]; reusable: boolean; notes: string[] } {
  const byRow = new Map(rows.filter(r => r.source_row !== undefined).map(r => [r.source_row!, r]));
  const notes: string[] = [];
  const groups: PackagingRuleGroup[] = [];
  let reusable = true;

  for (const pkg of packages) {
    if (pkg.rows.length === 0) continue;
    const items = pkg.rows.map(n => byRow.get(n)).filter(Boolean) as WorkOrderSourceItem[];
    const label = pkg.label.trim() || `포장 ${groups.length + 1}`;

    const units = asUnitsRule(items, rows, label);
    if (units) {
      groups.push(units);
      continue;
    }

    const blocks = asBlocksRule(items, rows, label);
    if (blocks) {
      groups.push(blocks);
      continue;
    }

    groups.push({ kind: 'rows', label, rows: [...pkg.rows] });
    reusable = false;
    notes.push(`"${label}" 은 동·호나 품명 블록으로 설명되지 않아 행 번호로 저장됩니다.`);
  }

  if (!reusable) {
    notes.push('행 번호로 저장된 포장이 있어 다음 차수 발주서에는 적용되지 않습니다.');
  }

  return { groups, reusable, notes };
}

/**
 * 한 포장이 "같은 동의 특정 호들" 로 설명되는지 본다.
 *
 * 설명이 되려면 그 동·호에 속한 행이 **하나도 빠짐없이** 이 포장에 들어 있어야 한다.
 * 일부만 들어 있으면 규칙으로 쓸 수 없다 — 다음 차수에 적용하면 나머지까지 딸려 온다.
 */
function asUnitsRule(
  items: WorkOrderSourceItem[],
  all: WorkOrderSourceItem[],
  label: string,
): PackagingRuleGroup | null {
  if (items.length === 0) return null;
  if (!items.every(r => r.location_dong && r.location_line)) return null;

  const dongs = new Set(items.map(r => r.location_dong!));
  if (dongs.size !== 1) return null;
  const dong = [...dongs][0];
  const units = [...new Set(items.map(r => r.location_line!))];

  // 같은 동·호인데 이 포장에 없는 행이 있으면 기준이 성립하지 않는다
  const unitSet = new Set(units);
  const captured = all.filter(r => r.location_dong === dong && r.location_line && unitSet.has(r.location_line));
  if (captured.length !== items.length) return null;

  return { kind: 'units', label: label || `${dong} ${formatUnitRange(units)}`, dong, units };
}

/** 한 포장이 "특정 품명 블록 전체" 로 설명되는지 본다. */
function asBlocksRule(
  items: WorkOrderSourceItem[],
  all: WorkOrderSourceItem[],
  label: string,
): PackagingRuleGroup | null {
  if (items.length === 0) return null;

  const products = [...new Set(items.map(r => r.product_name))];
  if (products.some(p => !p)) return null;

  const productSet = new Set(products);
  const captured = all.filter(r => productSet.has(r.product_name));
  if (captured.length !== items.length) return null;

  return { kind: 'blocks', label, products };
}

/**
 * 저장된 규칙을 새 발주서에 적용한다.
 *
 * 규칙이 한 행도 못 찾으면 그 포장은 비워 둔 채로 알린다 — 조용히 넘어가면
 * 사원이 "적용됐다" 고 믿고 빈 포장을 ERP에 올리게 된다.
 */
export function applyRule(
  rule: Pick<PackagingRule, 'groups'>,
  rows: WorkOrderSourceItem[],
): { packages: ManualPackage[]; notes: string[] } {
  const notes: string[] = [];
  const used = new Set<number>();

  const packages = rule.groups.map(g => {
    const matched = matchGroup(g, rows).filter(n => !used.has(n));
    matched.forEach(n => used.add(n));
    if (matched.length === 0) {
      notes.push(`"${g.label}" 에 해당하는 행을 찾지 못했습니다.`);
    }
    return { id: newPackageId(), label: g.label, rows: matched };
  });

  const left = rows.filter(r => r.source_row !== undefined && !used.has(r.source_row!));
  if (left.length > 0) {
    notes.push(`저장된 규칙에 걸리지 않은 품목이 ${left.length}건 있습니다. 직접 배정해 주세요.`);
  }

  return { packages, notes };
}

function matchGroup(group: PackagingRuleGroup, rows: WorkOrderSourceItem[]): number[] {
  if (group.kind === 'units') {
    const units = new Set(group.units);
    return rowNumbers(
      rows.filter(r => r.location_dong === group.dong && r.location_line && units.has(r.location_line)),
    );
  }
  if (group.kind === 'blocks') {
    const products = new Set(group.products);
    return rowNumbers(rows.filter(r => products.has(r.product_name)));
  }
  const wanted = new Set(group.rows);
  return rowNumbers(rows.filter(r => r.source_row !== undefined && wanted.has(r.source_row)));
}

const rowNumbers = (rows: WorkOrderSourceItem[]) =>
  rows.map(r => r.source_row).filter((n): n is number => n !== undefined);

/** 규칙을 사람이 읽을 한 줄로 — 저장 목록과 적용 안내에 쓴다 */
export function describeRule(rule: Pick<PackagingRule, 'groups'>): string {
  return rule.groups
    .map(g => {
      if (g.kind === 'units') return `${g.label}(${g.dong} ${formatUnitRange(g.units)})`;
      if (g.kind === 'blocks') return `${g.label}(품명 ${g.products.length}종)`;
      return `${g.label}(${g.rows.length}행 고정)`;
    })
    .join(' / ');
}
