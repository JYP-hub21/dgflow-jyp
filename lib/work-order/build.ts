/**
 * 발주서 품목 → 작업의뢰서 품목 변환
 *
 * 동일유리 실제 작업의뢰서(우미건설 남원주 역세권1차 5차 / 3동 1~3호)를 기준으로
 * 역산해 정리한 규칙이다. 규칙의 근거는 각 함수 주석에 적어 두었다.
 */

export interface WorkOrderSourceItem {
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  location_dong: string | null; // "3동"
  location_line: string | null; // "1호"  — 아파트 호 라인
  location_floor: string | null; // "21~25F"
  location_type: string | null; // "84A"
  location_room: string | null; // "거실F(外)"
  /**
   * 발주서에 위치가 **완성된 문자열로** 적혀 있을 때 그 원문.
   *
   * KCC건설 여의도 발주서는 비고 칸에 `구조마감 근생/1층/38/AW 우스텝-1W:920` 처럼
   * ERP에 넣을 형태가 그대로 들어 있다. 이때는 조각을 모아 조립하지 않고 이 값을 쓴다.
   * 실물 ERP 65행과 문자 단위로 일치함을 확인했다.
   */
  location_text?: string | null;
  /** 발주서 엑셀 행 번호 — 포장을 행으로 지정할 때와 화면 추적에 쓴다 */
  source_row?: number;
  /**
   * ERP 순서로 정렬하지 않고 발주서 순서를 그대로 둘 것.
   * 위치에 `우스텝-1`·`우스텝-2` 처럼 연번이 붙어 발주자가 순서를 지정한 블록이다.
   */
  keep_source_order?: boolean;
}

export interface WorkOrderItem {
  no: number;
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  area_m2: number;
  remark: string;
  /** 같은 품명 묶음의 첫 행에만 품명을 출력하기 위한 플래그 (양식이 병합 셀) */
  is_product_head: boolean;
  /** 이 한 줄로 합쳐진 발주서 원본 행들 — 검수·경고 생성용 */
  sources: WorkOrderSourceItem[];
}

export interface WorkOrderGroup {
  product_name: string;
  items: WorkOrderItem[];
  subtotal_quantity: number;
  subtotal_area: number;
}

export interface WorkOrderBuild {
  groups: WorkOrderGroup[];
  items: WorkOrderItem[];
  total_quantity: number;
  total_area: number;
}

/** 포장 단위 — 작업의뢰서 1장에 해당한다. */
export interface PackagingGroup {
  dong: string; // "3동"
  units: string[]; // ["1호", "2호", "3호"]
  label: string; // "3동 1~3호"
  /**
   * 발주서 행 번호로 직접 지정된 포장. 있으면 동·호 대신 이걸로 고른다.
   *
   * 동·호가 없는 현장(근생·오피스텔 등)은 동·호로 포장을 나눌 수 없다.
   * 대신 발주서가 "※ 회색 합계 단위로 포장부탁드립니다" 라고 적고 소계 행으로 끊어 준다.
   */
  row_keys?: number[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 장당 면적을 먼저 소수점 2자리로 반올림한 뒤 수량을 곱한다.
 *
 * 실제 작업의뢰서가 이 순서다. 1,719×1,820을 15장 하면
 * 3.12858×15 = 46.93 이 아니라 3.13×15 = 46.95 로 적혀 있다.
 * (기존 lib/calc/area.ts 의 면적은 총면적을 한 번에 반올림하므로 값이 다르다.)
 */
export function sheetArea(width_mm: number, height_mm: number, quantity: number): number {
  return round2(round2((width_mm * height_mm) / 1_000_000) * quantity);
}

/**
 * 발주서 상단의 포장 지시 문구를 포장 단위로 해석한다.
 *
 * 예) " 1,3,4동( 1,2,3호 포장,4,5호 포장),2동(1,2호 포장 , 3,4,5호포장 ) , 5동 ( 1,2,3호 포장 )"
 *  → 1동 1~3호 / 1동 4~5호 / 3동 1~3호 / ... / 5동 1~3호
 *
 * 문구는 사람이 자유롭게 적는 칸이라 실패할 수 있다. 실패하면 빈 배열을 돌려주고
 * 호출 측에서 사용자가 직접 동·호를 고르게 한다.
 */
export function parsePackagingInstruction(text: string): PackagingGroup[] {
  const groups: PackagingGroup[] = [];
  if (!text) return groups;

  // "1,3,4동( ... )" 단위로 끊는다
  const blockRe = /([\d,\s]+)동\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(text)) !== null) {
    const dongs = match[1].split(',').map(s => s.trim()).filter(Boolean);
    const body = match[2];

    // 괄호 안: "1,2,3호 포장, 4,5호 포장"
    const unitSets = body
      .split('포장')
      .map(s => s.replace(/[,\s]+$/, '').trim())
      .filter(s => /\d/.test(s));

    for (const dong of dongs) {
      for (const set of unitSets) {
        const units = (set.match(/\d+/g) || []).map(n => `${n}호`);
        if (units.length === 0) continue;
        groups.push({
          dong: `${dong}동`,
          units,
          label: `${dong}동 ${formatUnitRange(units)}`,
        });
      }
    }
  }

  return groups;
}

/**
 * 호 목록을 작업의뢰서 표기로 압축한다.
 * 연속이면 "1~3호", 끊기면 "1,3호".
 */
export function formatUnitRange(units: string[]): string {
  // `1,3호` 처럼 한 칸에 라인이 여럿 적힌 발주서가 있다 (흥화) — 쪼개서 센다
  const nums = [...new Set(
    units.flatMap(u => u.split(',')).map(u => parseInt(u, 10)).filter(n => !isNaN(n)),
  )].sort((a, b) => a - b);
  if (nums.length === 0) return '';
  if (nums.length === 1) return `${nums[0]}호`;

  // 3개 이상 연속일 때만 물결로 줄인다. 2개는 "1,2호" 로 적는다 (실제 작업의뢰서 13번 항목).
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return contiguous && nums.length >= 3
    ? `${nums[0]}~${nums[nums.length - 1]}호`
    : `${nums.join(',')}호`;
}

/**
 * 타입 목록을 압축한다. 숫자 접두사가 같으면 한 번만 쓴다.
 * ["84A","84B"] → "84A,B"   ["84A"] → "84A"   ["84A","59B"] → "84A,59B"
 *
 * 접미사는 알파벳순으로 적는다. 2동은 1호가 84C, 2호가 84A 로 호 순서가 C→A 인데도
 * 실제 ERP 엑셀에는 "84A,C" 로 들어가 있다 (ERP-2026년.xlsx / 우미 남원주7차 (3)).
 */
export function formatTypes(types: string[]): string {
  const uniq = [...new Set(types.filter(Boolean))];
  if (uniq.length === 0) return '';
  if (uniq.length === 1) return uniq[0];

  const parsed = uniq.map(t => t.match(/^(\d+)(.*)$/));
  const prefix = parsed[0]?.[1];
  if (prefix && parsed.every(p => p && p[1] === prefix)) {
    return prefix + parsed.map(p => p![2]).sort().join(',');
  }
  return uniq.join(',');
}

/**
 * 실명 표기 방식 — **문서마다 다르다.**
 *
 * 3동 1~3호 455×950 이 그 차이가 드러나는 자리다. 1·3호는 주방/식당 창만 10장씩인데
 * 2호는 드레스룸 창까지 있어 20장이라, 발주서 실명이
 * `주방/식당` 과 `주방/식당,드레스룸` 으로 갈린다. 같은 상황을 두 문서가 다르게 적었다.
 *
 * | 문서 | 표기 | 근거 |
 * |---|---|---|
 * | ERP 업로드 엑셀 | `주방/식당,드레스룸` | ERP-2026년.xlsx 9시트 전부 |
 * | 작업의뢰서 | `주방/식당` | 26-1952 스캔본 |
 *
 * 작업의뢰서는 회사 ERP 가 뽑아 주는 문서라 우리 출력물이 아니다 —
 * 줄여 쓰는 쪽은 ERP 의 표기 습관으로 보인다. 그래서 강제로 하나로 맞추지 않고
 * 만드는 문서에 따라 고른다.
 */
export type RoomPolicy =
  /** 합쳐진 호들의 창을 전부 가리키는 쪽 (ERP 업로드 엑셀) */
  | 'widest'
  /** 첫 행의 값 (작업의뢰서) */
  | 'first';

/**
 * 여러 호를 한 줄로 합칠 때 실명을 고른다.
 *
 * `widest` 는 합쳐진 줄이 그 호들의 창을 **전부** 담는다는 사실에서 나온다 —
 * 첫 값을 쓰면 2호의 드레스룸 창이 라벨에서 사라진다.
 * 실물 ERP 9시트가 예외 없이 포괄하는 쪽을 적었다 (136행 전수 대조).
 *
 * 다만 서로 포함 관계가 아니면(예: `거실` 과 `침실`) 무엇을 적을지 알 수 없다.
 * 그때는 고르지 않고 `ambiguous` 로 알려 호출 측이 사람에게 묻게 한다.
 */
export function pickRoom(
  rooms: (string | null | undefined)[],
  policy: RoomPolicy = 'widest',
): { room: string; ambiguous: boolean } {
  const uniq = [...new Set(rooms.filter(Boolean) as string[])];
  if (uniq.length <= 1) return { room: uniq[0] ?? '', ambiguous: false };
  if (policy === 'first') return { room: uniq[0], ambiguous: uniq.length > 1 };

  // 창구분 접미사가 섞이면 같은 줄로 볼 수 없다 (원래 品名 블록이 달라 합쳐지지 않지만 방어)
  const suffixes = new Set(uniq.map(r => r.match(/\((?:外|內)\)\s*$/)?.[0] ?? ''));
  if (suffixes.size > 1) return { room: uniq[0], ambiguous: true };

  const partsOf = (s: string) =>
    new Set(
      s.replace(/\((?:外|內)\)\s*$/, '')
        .split(',')
        .map(t => t.trim())
        .filter(Boolean),
    );

  // 나머지를 전부 포함하는 후보가 있으면 그게 답이다
  const widest = uniq.find(candidate => {
    const own = partsOf(candidate);
    return uniq.every(other => [...partsOf(other)].every(part => own.has(part)));
  });

  return widest ? { room: widest, ambiguous: false } : { room: uniq[0], ambiguous: true };
}

/**
 * 비고란 조립: "3동 1~3호 84A,B 21~25F 거실F(外)"
 *
 * 동 · 호 · 타입 · 층은 실제로 기여한 발주서 행에서만 모은다.
 * 그래서 2호에 없는 품목은 "3동 1,3호" 로 나온다 (실제 작업의뢰서 5번 항목).
 * 실명은 `pickRoom` 규칙으로 고른다.
 */
export function buildRemark(rows: WorkOrderSourceItem[], policy: RoomPolicy = 'widest'): string {
  // 발주서에 완성된 위치 문자열이 있으면 조립하지 않고 그대로 쓴다.
  const verbatim = rows.find(r => r.location_text)?.location_text;
  if (verbatim) return verbatim;

  const dongs = [...new Set(rows.map(r => r.location_dong).filter(Boolean))] as string[];
  const units = rows.map(r => r.location_line).filter(Boolean) as string[];
  const types = rows.map(r => r.location_type).filter(Boolean) as string[];
  const floors = [...new Set(rows.map(r => r.location_floor).filter(Boolean))] as string[];
  const room = pickRoom(rows.map(r => r.location_room), policy).room;

  return [dongs.join(','), formatUnitRange(units), formatTypes(types), floors.join(','), room]
    .filter(Boolean)
    .join(' ');
}

/**
 * 같은 품명 + 같은 규격끼리 묶어 작업의뢰서 품목을 만든다.
 *
 * - 품명 묶음 순서: 발주서에 처음 나온 순서
 * - 묶음 안 규격 순서: 세로 내림차순 → 가로 내림차순 (실제 작업의뢰서와 일치)
 * - 수량은 합산, 면적은 sheetArea 규칙
 */
export function buildWorkOrder(
  rows: WorkOrderSourceItem[],
  /** 실명 표기 방식 — 작업의뢰서는 'first', ERP 업로드 엑셀은 'widest' (RoomPolicy 참고) */
  roomPolicy: RoomPolicy = 'first',
): WorkOrderBuild {
  const byProduct = new Map<string, Map<string, WorkOrderSourceItem[]>>();

  for (const row of rows) {
    if (!(row.width_mm > 0 && row.height_mm > 0 && row.quantity > 0)) continue;
    if (!byProduct.has(row.product_name)) byProduct.set(row.product_name, new Map());
    const specs = byProduct.get(row.product_name)!;
    const key = `${row.width_mm}x${row.height_mm}`;
    if (!specs.has(key)) specs.set(key, []);
    specs.get(key)!.push(row);
  }

  const groups: WorkOrderGroup[] = [];
  let no = 0;

  for (const [product_name, specs] of byProduct) {
    // 발주자가 위치에 연번을 매긴 블록은 그 순서가 곧 지시다 — 재배열하지 않는다.
    const keepOrder = [...specs.values()].every(g => g.every(r => r.keep_source_order));

    const specRows = keepOrder
      ? [...specs.values()]
      : [...specs.values()].sort((a, b) => {
          const byHeight = b[0].height_mm - a[0].height_mm;
          return byHeight !== 0 ? byHeight : b[0].width_mm - a[0].width_mm;
        });

    const items: WorkOrderItem[] = specRows.flatMap(group =>
      splitForMerge(group).map(part => ({
        no: ++no,
        product_name,
        width_mm: part[0].width_mm,
        height_mm: part[0].height_mm,
        quantity: part.reduce((sum, r) => sum + r.quantity, 0),
        area_m2: sheetArea(
          part[0].width_mm,
          part[0].height_mm,
          part.reduce((sum, r) => sum + r.quantity, 0),
        ),
        remark: buildRemark(part, roomPolicy),
        is_product_head: false, // 아래에서 묶음 첫 행에만 다시 켠다
        sources: part,
      })),
    );

    if (items.length > 0) items[0].is_product_head = true;

    groups.push({
      product_name,
      items,
      subtotal_quantity: items.reduce((s, i) => s + i.quantity, 0),
      subtotal_area: round2(items.reduce((s, i) => s + i.area_m2, 0)),
    });
  }

  const items = groups.flatMap(g => g.items);

  return {
    groups,
    items,
    total_quantity: items.reduce((s, i) => s + i.quantity, 0),
    total_area: round2(items.reduce((s, i) => s + i.area_m2, 0)),
  };
}

/**
 * 같은 규격 묶음을 **합칠지 말지** 정한다.
 *
 * 두 실물이 정반대로 적혀 있어서, 둘 다 설명하는 규칙을 찾아야 했다.
 *
 * | 실물 | 같은 규격 행들 | ERP 결과 |
 * |---|---|---|
 * | 우미 남원주7차 | `3동 1호`·`2호`·`3호` — **위치가 다름** | 한 줄 `3동 1~3호` 로 합침 |
 * | KCC 여의도 9/17 | `구조마감 근생/1층/41/AW` ×2 — **위치가 같음** | **두 줄 그대로** (수량 4+4) |
 *
 * 즉 합치는 행위의 본질은 "여러 호를 하나로 묶는 것" 이지 "수량을 더하는 것" 이 아니다.
 * 위치가 똑같은 두 줄은 발주서가 같은 내용을 두 번 적은 것이므로, 사람이 보고 판단해야 한다 —
 * 우리가 말없이 합치면 중복 발주인지 정상인지 구분할 방법이 사라진다.
 *
 * 그래서 위치가 서로 다를 때만 합치고, 겹치는 위치가 있으면 발주서 행을 그대로 내보낸다.
 */
function splitForMerge(group: WorkOrderSourceItem[]): WorkOrderSourceItem[][] {
  if (group.length <= 1) return [group];

  // 발주서에 완성된 위치 문자열이 있는 양식은 합치지 않는다.
  // (ERP 실물이 발주서 행과 1:1 이었다 — KCC 여의도 65행 전수 대조)
  if (group.some(r => r.location_text)) return group.map(r => [r]);

  const seen = new Map<string, number>();
  for (const row of group) {
    const key = locationKey(row);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  const hasDuplicate = [...seen.values()].some(n => n > 1);
  return hasDuplicate ? group.map(r => [r]) : [group];
}

const locationKey = (r: WorkOrderSourceItem) =>
  [r.location_dong, r.location_line, r.location_type, r.location_floor, r.location_room]
    .map(v => v ?? '')
    .join('|');

/** 포장 단위에 속한 발주서 행만 골라낸다. */
export function filterByPackaging(
  rows: WorkOrderSourceItem[],
  group: Pick<PackagingGroup, 'dong' | 'units' | 'row_keys'>
): WorkOrderSourceItem[] {
  // 행 번호로 지정된 포장이 우선 — 동·호가 없는 현장을 위한 경로다.
  if (group.row_keys && group.row_keys.length > 0) {
    const keys = new Set(group.row_keys);
    return rows.filter(r => r.source_row !== undefined && keys.has(r.source_row));
  }

  const units = new Set(group.units);
  return rows.filter(r => r.location_dong === group.dong && r.location_line && units.has(r.location_line));
}
