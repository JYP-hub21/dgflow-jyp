/**
 * 발주서 → ERP 업로드용 엑셀
 *
 * 실제 업무 흐름은 발주서 → 규격정리 → ERP 업로드 엑셀 → (회사 ERP) → 작업의뢰서 다.
 * 중간 단계인 규격정리는 발주서에 없는 정보를 만들지 않는다 —
 * 품명 변환 / 평·M2 계산 / ERP 순서 재배열만 한다. 그래서 발주서에서 바로 생성한다.
 * (우미 남원주 7차 136행으로 대조 검증: 규격·수량 전부 일치)
 *
 * ERP 양식은 `위치 | 가로 | 세로 | 수량` 4열이고 품명 열이 없다.
 * 시트 1장 = 포장 1개 = 작업의뢰서 1장.
 *
 * ── 설계 원칙 ──────────────────────────────────────────────
 * 발주서는 양식이 같아도 작성자마다 내용이 다르고, 학습되지 않은 양식이 계속 들어온다.
 * 그래서 이 모듈은 **확실하게 읽어낸 값만 채우고, 판단이 필요한 값은 비운 뒤 `review` 에 남긴다.**
 * 추측으로 채워 넣지 않는다 — 틀린 값이 ERP를 거쳐 작업의뢰서까지 가면 유리를 잘못 자른다.
 */
import {
  buildWorkOrder,
  filterByPackaging,
  pickRoom,
  formatUnitRange,
  type PackagingGroup,
  type WorkOrderSourceItem,
} from '@/lib/work-order/build';

/** ERP 업로드 엑셀의 한 행 */
export interface ErpUploadRow {
  /** 위치 — 읽어낸 조각만 이어 붙인다. 못 읽은 조각은 그냥 빠진다. */
  location: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  /** ERP 양식에는 없지만 검수 화면에 보여 준다 */
  product_name: string;
  /** 이 한 줄로 합쳐진 발주서 행 수 */
  merged_from: number;
  /** 사람이 확인해야 하는 점 */
  review: string[];
}

export interface ErpUploadSheet {
  /** 엑셀 시트명 */
  sheet_name: string;
  /** 포장 단위 라벨 — "3동 1~3호" */
  packaging_label: string;
  /** 포장 단위를 무엇을 근거로 나눴는지 */
  source: PackagingSource;
  rows: ErpUploadRow[];
  total_quantity: number;
  review: string[];
}

export type PackagingSource =
  /** 발주서 상단 포장 지시문에서 나왔다 */
  | 'instruction'
  /** 품목의 동·호 조합에서 추론했다 */
  | 'derived'
  /** 포장 단위를 찾지 못해 전체를 한 장으로 묶었다 */
  | 'fallback-single';

export interface ErpUploadBuild {
  sheets: ErpUploadSheet[];
  /** 어느 포장에도 들어가지 못한 품목 — 버리지 않고 따로 보고한다 */
  unassigned: WorkOrderSourceItem[];
  /** 파일 전체에 걸린 확인 사항 */
  review: string[];
  total_quantity: number;
}

const PACKAGING_SOURCE_LABEL: Record<PackagingSource, string> = {
  instruction: '발주서 포장 지시문',
  derived: '동·호 조합에서 추론',
  'fallback-single': '포장 단위 불명 — 전체 한 장',
};

/**
 * 발주서 상단의 "동순서 3-4-2-1-5" 를 읽어 동 배열로 돌려준다.
 *
 * ERP 실물(ERP-2026년.xlsx)의 시트 배치가 이 순서와 정확히 같다 —
 * 3동 1~3호, 3동 4,5호, 4동 1~3호, 4동 4,5호, 2동 1,2호, 2동 3~5호,
 * 1동 1~3호, 1동 4,5호, 5동 1~3호. 현장에서 그 순서로 싣기 때문이다.
 *
 * 사람이 자유롭게 적는 칸이라 없거나 못 읽을 수 있다. 그때는 빈 배열을 돌려주고
 * 호출 측이 지시문에 적힌 순서를 그대로 쓴다.
 */
export function parseDongOrder(text: string): string[] {
  if (!text) return [];
  const m = text.match(/동\s*순\s*서\s*[)\s]*([\d\s]+(?:[-,~/]\s*\d+\s*)+)/);
  if (!m) return [];
  const nums = m[1].match(/\d+/g);
  if (!nums || nums.length < 2) return [];
  return [...new Set(nums.map(n => `${n}동`))];
}

/**
 * 동순서 지시에 맞춰 시트를 정렬한다.
 * 지시에 없는 동은 순서를 건드리지 않고 뒤에 붙인다.
 */
function sortByDongOrder<T extends { packaging_label: string }>(sheets: T[], dongOrder: string[]): T[] {
  if (dongOrder.length === 0) return sheets;
  const rank = new Map(dongOrder.map((d, i) => [d, i]));
  return sheets
    .map((s, i) => ({ s, i, r: rank.get(s.packaging_label.split(' ')[0]) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.s);
}

/**
 * 포장 단위별 ERP 업로드 시트를 만든다.
 *
 * @param items    발주서에서 파싱한 품목 전체
 * @param groups   포장 단위 후보. 비어 있으면 전체를 한 장으로 묶고 그 사실을 알린다.
 * @param source   groups 를 무엇에서 얻었는지 (검수 화면에 근거를 보여 주기 위해)
 */
export function buildErpUpload(
  items: WorkOrderSourceItem[],
  groups: PackagingGroup[],
  source: PackagingSource = 'instruction',
  /** 발주서 상단의 "동순서 …" 로 시트 순서를 맞춘다. 없으면 지시문 순서를 그대로 쓴다. */
  dongOrder: string[] = [],
): ErpUploadBuild {
  const review: string[] = [];

  // 포장 단위를 못 찾았으면 전체를 한 장으로 — 임의로 쪼개지 않는다.
  if (groups.length === 0) {
    const build = buildSheet(items, '전체', '전체', 'fallback-single');
    build.review.unshift(
      '포장 단위를 찾지 못해 전체를 한 장으로 묶었습니다. 실제 포장 단위에 맞게 직접 나눠 주세요.',
    );
    return {
      sheets: [build],
      unassigned: [],
      review,
      total_quantity: build.total_quantity,
    };
  }

  let sheets: ErpUploadSheet[] = [];
  const used = new Set<WorkOrderSourceItem>();
  const nameSeen = new Map<string, number>();

  for (const group of groups) {
    const rows = filterByPackaging(items, group);
    if (rows.length === 0) continue;
    rows.forEach(r => used.add(r));

    const sheet = buildSheet(rows, group.label, uniqueSheetName(group.label, nameSeen), source);
    sheets.push(sheet);
  }

  // 현장에서 싣는 순서대로 시트를 배치한다 (발주서 "동순서 3-4-2-1-5")
  if (dongOrder.length > 0) {
    sheets = sortByDongOrder(sheets, dongOrder);
    review.push(`시트 순서를 발주서 동순서(${dongOrder.join('-').replace(/동/g, '')})에 맞췄습니다.`);
  }

  // 포장에 안 들어간 품목 — 동·호를 못 읽었거나 지시문이 빠뜨린 세대다.
  const unassigned = items.filter(i => !used.has(i) && i.quantity > 0 && i.width_mm > 0 && i.height_mm > 0);
  if (unassigned.length > 0) {
    const where = [...new Set(unassigned.map(u => [u.location_dong, u.location_line].filter(Boolean).join(' ') || '위치 불명'))];
    review.push(
      `어느 포장에도 들어가지 못한 품목이 ${unassigned.length}건 있습니다 (${where.slice(0, 6).join(', ')}${where.length > 6 ? ' 외' : ''}). ` +
        '포장 단위를 직접 지정하거나 발주서의 동·호 표기를 확인해 주세요.',
    );
  }

  if (sheets.length === 0) {
    review.push('포장 단위에 걸리는 품목이 없습니다. 발주서의 동·호 표기를 확인해 주세요.');
  }

  return {
    sheets,
    unassigned,
    review,
    total_quantity: sheets.reduce((s, x) => s + x.total_quantity, 0),
  };
}

/**
 * 한 포장 단위를 ERP 시트로 만든다.
 *
 * 행 순서와 병합은 작업의뢰서와 같은 규칙이다 (lib/work-order/build.ts):
 * 품명 묶음은 발주서 등장 순서, 묶음 안은 세로 내림차순 → 가로 내림차순,
 * 같은 품명 + 같은 규격은 한 줄로 합치고 수량을 더한다.
 */
function buildSheet(
  rows: WorkOrderSourceItem[],
  packagingLabel: string,
  sheetName: string,
  source: PackagingSource,
): ErpUploadSheet {
  // ERP 업로드 엑셀은 합친 호들의 창을 전부 가리키는 실명을 쓴다 (실물 9시트 근거)
  const build = buildWorkOrder(rows, 'widest');
  const review: string[] = [];

  const erpRows: ErpUploadRow[] = build.items.map(item => {
    const rowReview: string[] = [];

    // 발주서가 위치를 완성된 문자열로 적어 준 양식은 조각을 따질 필요가 없다.
    //
    // 동·호가 아예 존재하지 않는 현장이 있다 — 근생·오피스텔은 `근생/1층/38/AW` 가 위치의 전부다.
    // 그런 발주서에 "동을 읽지 못했다" 고 매 행 경고하면 화면이 경고로 뒤덮여
    // 정작 사람이 봐야 할 행이 묻힌다. (KCC 여의도 9/17 은 64행 전부가 그렇게 표시됐다)
    const hasVerbatim = item.sources.some(s => s.location_text);

    if (hasVerbatim) {
      if (!item.remark) rowReview.push('위치를 읽지 못해 비워 뒀습니다.');
    } else {
      // 위치 조각 중 못 읽은 것 알리기 — 추측으로 채우지 않는다.
      const missing: string[] = [];
      if (!item.sources.some(s => s.location_dong)) missing.push('동');
      if (!item.sources.some(s => s.location_line)) missing.push('호');
      if (!item.sources.some(s => s.location_type)) missing.push('타입');
      if (!item.sources.some(s => s.location_floor)) missing.push('층');
      if (!item.sources.some(s => s.location_room)) missing.push('실명');
      if (missing.length > 0) {
        rowReview.push(`위치에서 ${missing.join('·')}을 읽지 못해 비워 뒀습니다.`);
      }
    }

    // 합친 호들의 실명이 다를 때는 **포괄하는 쪽**을 쓴다 (`pickRoom` 참고).
    // 합쳐진 줄은 그 호들의 창을 전부 담으므로 라벨도 전부를 가리켜야 한다.
    // 포함 관계가 아니어서 고를 수 없을 때만 사람에게 묻는다.
    const rooms = [...new Set(item.sources.map(s => s.location_room).filter(Boolean))] as string[];
    const picked = pickRoom(rooms);
    if (picked.ambiguous) {
      rowReview.push(
        `합친 호들의 실명이 서로 다른데 포함 관계가 아닙니다 (${rooms.join(' / ')}). ` +
          `"${picked.room}" 을 넣었으니 확인해 주세요.`,
      );
    }

    return {
      location: item.remark,
      width_mm: item.width_mm,
      height_mm: item.height_mm,
      quantity: item.quantity,
      product_name: item.product_name,
      merged_from: item.sources.length,
      review: rowReview,
    };
  });

  const flagged = erpRows.filter(r => r.review.length > 0).length;
  if (flagged > 0) review.push(`${flagged}개 행에 확인이 필요합니다.`);

  // 정렬 규칙을 바꾼 블록이 있으면 한 번만 알린다 (행마다 반복하면 표가 경고로 덮인다)
  const kept = [...new Set(
    rows.filter(r => r.keep_source_order).map(r => r.product_name),
  )];
  if (kept.length > 0) {
    review.push(
      `${kept.join(', ')} 블록은 위치에 연번이 붙어 있어 ERP 순서로 재배열하지 않고 ` +
        '발주서 순서를 그대로 두었습니다.',
    );
  }

  return {
    sheet_name: sheetName,
    packaging_label: packagingLabel,
    source,
    rows: erpRows,
    total_quantity: erpRows.reduce((s, r) => s + r.quantity, 0),
    review,
  };
}

/**
 * 엑셀 시트명으로 쓸 수 있게 다듬는다.
 * 엑셀은 시트명에 : \ / ? * [ ] 를 못 쓰고 31자를 넘길 수 없다. 중복도 안 된다.
 */
function uniqueSheetName(label: string, seen: Map<string, number>): string {
  const base = (label.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim() || '시트').slice(0, 28);
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base} (${n})`;
}

/** 검수 화면에 근거를 한국어로 보여 준다. */
export function packagingSourceLabel(source: PackagingSource): string {
  return PACKAGING_SOURCE_LABEL[source];
}

/** 포장 단위 라벨을 동·호에서 만든다 (사용자가 직접 고를 때 사용) */
export function packagingLabelOf(dong: string, units: string[]): string {
  return [dong, formatUnitRange(units)].filter(Boolean).join(' ');
}
