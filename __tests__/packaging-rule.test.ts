// @vitest-environment node
/**
 * 수동 포장 구성 · 현장별 포장 규칙 테스트.
 *
 * 여기서 조용히 틀리면 피해가 크다 — 저장된 규칙이 다음 차수에 잘못 적용되면
 * 포장이 통째로 뒤섞인 채로 ERP에 올라간다. 그래서 두 가지를 못 박아 둔다.
 *
 *  1. 기준을 **못 뽑아내면 일반화하지 않는다** (`reusable: false`)
 *  2. 행은 **어떤 경우에도 사라지지 않는다** (미배정으로 남는다)
 */
import { describe, it, expect } from 'vitest';
import {
  applyRule, deriveRule, describeRule, seedFromGroups, toPackagingGroups, unassignedRows,
  type ManualPackage,
} from '@/lib/erp/packaging-rule';
import { filterByPackaging, type PackagingGroup, type WorkOrderSourceItem } from '@/lib/work-order/build';

/** 우미식 — 동·호가 있는 아파트 발주서 */
function apartmentRows(): WorkOrderSourceItem[] {
  const rows: WorkOrderSourceItem[] = [];
  let excel = 15;
  for (const dong of ['3동', '4동']) {
    for (const line of ['1호', '2호', '3호']) {
      rows.push({
        product_name: '5CL+12Ar+5로이',
        width_mm: 1000, height_mm: 2000, quantity: 5,
        location_dong: dong, location_line: line,
        location_floor: '31~35F', location_type: '84A', location_room: '거실',
        source_row: excel++,
      });
    }
  }
  return rows;
}

/** KCC식 — 동·호가 없고 품명 블록만 있는 근생 발주서 */
function blockRows(): WorkOrderSourceItem[] {
  const make = (product: string, n: number, from: number): WorkOrderSourceItem[] =>
    Array.from({ length: n }, (_, i) => ({
      product_name: product,
      width_mm: 1000 + i, height_mm: 2830, quantity: 2,
      location_dong: null, location_line: null,
      location_floor: null, location_type: null, location_room: null,
      location_text: `구조마감 근생/1층/${30 + i}/AW`,
      source_row: from + i,
    }));
  return [...make('5MVT172(근생)', 3, 15), ...make('10CL T/P', 4, 20)];
}

const pkg = (label: string, rows: number[]): ManualPackage => ({ id: label, label, rows });

describe('수동 포장 구성', () => {
  it('자동 결과를 출발점으로 복사한다 — 빈 화면에서 시작하지 않는다', () => {
    const rows = apartmentRows();
    const groups: PackagingGroup[] = [
      { dong: '3동', units: ['1호', '2호', '3호'], label: '3동 1~3호' },
      { dong: '4동', units: ['1호', '2호', '3호'], label: '4동 1~3호' },
    ];

    const seeded = seedFromGroups(rows, groups, filterByPackaging);
    expect(seeded.map(p => p.label)).toEqual(['3동 1~3호', '4동 1~3호']);
    expect(seeded.map(p => p.rows.length)).toEqual([3, 3]);
    expect(unassignedRows(rows, seeded)).toEqual([]);
  });

  it('포장 단위가 없으면 전체를 한 포장으로 놓고 시작한다', () => {
    const rows = apartmentRows();
    const seeded = seedFromGroups(rows, [], filterByPackaging);
    expect(seeded).toHaveLength(1);
    expect(seeded[0].rows).toHaveLength(rows.length);
  });

  it('어디에도 안 들어간 행을 미배정으로 돌려준다', () => {
    const rows = apartmentRows();
    const packages = [pkg('포장 1', [15, 16])];
    const left = unassignedRows(rows, packages);
    expect(left.map(r => r.source_row)).toEqual([17, 18, 19, 20]);
  });

  it('빈 포장은 ERP 시트로 나가지 않는다', () => {
    const groups = toPackagingGroups([pkg('포장 1', [15, 16]), pkg('빈 포장', [])]);
    expect(groups).toHaveLength(1);
    expect(groups[0].row_keys).toEqual([15, 16]);
  });
});

describe('규칙 뽑아내기 — 다음 차수에 쓸 수 있는가', () => {
  it('동·호로 깔끔히 갈리면 동·호 기준으로 저장한다', () => {
    const rows = apartmentRows();
    const derived = deriveRule(
      [pkg('3동 1~3호', [15, 16, 17]), pkg('4동 1~3호', [18, 19, 20])],
      rows,
    );

    expect(derived.reusable).toBe(true);
    expect(derived.groups).toEqual([
      { kind: 'units', label: '3동 1~3호', dong: '3동', units: ['1호', '2호', '3호'] },
      { kind: 'units', label: '4동 1~3호', dong: '4동', units: ['1호', '2호', '3호'] },
    ]);
  });

  it('품명 블록으로 갈리면 품명 기준으로 저장한다', () => {
    const rows = blockRows();
    const derived = deriveRule(
      [pkg('포장 1', [15, 16, 17]), pkg('포장 2', [20, 21, 22, 23])],
      rows,
    );

    expect(derived.reusable).toBe(true);
    expect(derived.groups).toEqual([
      { kind: 'blocks', label: '포장 1', products: ['5MVT172(근생)'] },
      { kind: 'blocks', label: '포장 2', products: ['10CL T/P'] },
    ]);
  });

  it('블록 중간을 쪼개면 일반화하지 않고 이 차수 전용으로 남긴다', () => {
    const rows = blockRows();
    // 5MVT172 블록 3행 중 2행만 떼어 냈다 — 품명으로도 동·호로도 설명되지 않는다
    const derived = deriveRule([pkg('포장 1', [15, 16]), pkg('포장 2', [17, 20, 21, 22, 23])], rows);

    expect(derived.reusable).toBe(false);
    expect(derived.groups[0]).toEqual({ kind: 'rows', label: '포장 1', rows: [15, 16] });
    expect(derived.notes.join(' ')).toContain('다음 차수');
  });

  it('같은 동·호인데 일부만 담으면 동·호 기준으로 저장하지 않는다', () => {
    const rows = apartmentRows();
    // 3동 1호의 행이 둘로 갈렸다고 가정할 수 없으므로, 호 하나를 통째로 뺀 경우를 본다
    const derived = deriveRule([pkg('일부만', [15, 16])], rows);
    // 3동 1,2호 전체가 들어갔으므로 이건 성립한다
    expect(derived.groups[0].kind).toBe('units');

    // 반대로 4동 행을 3동 포장에 섞으면 동이 둘이라 성립하지 않는다
    const mixed = deriveRule([pkg('섞임', [15, 18])], rows);
    expect(mixed.groups[0].kind).toBe('rows');
    expect(mixed.reusable).toBe(false);
  });
});

describe('규칙 적용 — 다음 차수 발주서', () => {
  it('행 번호가 밀려도 동·호 기준은 그대로 통한다', () => {
    const next = apartmentRows().map(r => ({ ...r, source_row: r.source_row! + 100 }));
    const result = applyRule(
      {
        groups: [
          { kind: 'units', label: '3동 1~3호', dong: '3동', units: ['1호', '2호', '3호'] },
          { kind: 'units', label: '4동 1~3호', dong: '4동', units: ['1호', '2호', '3호'] },
        ],
      },
      next,
    );

    expect(result.packages.map(p => p.rows)).toEqual([[115, 116, 117], [118, 119, 120]]);
    expect(result.notes).toEqual([]);
    expect(unassignedRows(next, result.packages)).toEqual([]);
  });

  it('한 행이 두 포장에 중복해 들어가지 않는다', () => {
    const rows = blockRows();
    const result = applyRule(
      {
        groups: [
          { kind: 'blocks', label: '전부', products: ['5MVT172(근생)', '10CL T/P'] },
          { kind: 'blocks', label: '겹침', products: ['10CL T/P'] },
        ],
      },
      rows,
    );

    expect(result.packages[0].rows).toHaveLength(7);
    expect(result.packages[1].rows).toEqual([]);
    expect(result.notes.join(' ')).toContain('겹침');
  });

  it('규칙에 안 걸린 품목이 있으면 알린다 — 조용히 버리지 않는다', () => {
    const rows = blockRows();
    const result = applyRule(
      { groups: [{ kind: 'blocks', label: '일부', products: ['10CL T/P'] }] },
      rows,
    );

    expect(result.packages[0].rows).toHaveLength(4);
    expect(unassignedRows(rows, result.packages)).toHaveLength(3);
    expect(result.notes.join(' ')).toContain('3건');
  });

  it('없는 동을 가리키는 규칙은 빈 포장으로 두고 알린다', () => {
    const result = applyRule(
      { groups: [{ kind: 'units', label: '9동 1호', dong: '9동', units: ['1호'] }] },
      apartmentRows(),
    );
    expect(result.packages[0].rows).toEqual([]);
    expect(result.notes.join(' ')).toContain('찾지 못했습니다');
  });
});

describe('규칙 설명', () => {
  it('사람이 읽을 한 줄로 만든다', () => {
    const text = describeRule({
      groups: [
        { kind: 'units', label: '3동 1~3호', dong: '3동', units: ['1호', '2호', '3호'] },
        { kind: 'rows', label: '나머지', rows: [1, 2] },
      ],
    });
    expect(text).toBe('3동 1~3호(3동 1~3호) / 나머지(2행 고정)');
  });
});
